import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions,
  getDefaultGraphDigitalDocumentPermissions,
  ALL_AUDIENCES,
  ERROR_CODE_TRIGGERED_ACTION,
  Store
} from '../src/';

describe('post', function() {
  this.timeout(40000);

  const librarian = new Librarian({
    skipPayments: true,
    log: { level: 'fatal' }
  });
  let author, editor, organization, periodical, defaultCreateGraphAction;

  before(async () => {
    author = await registerUser();
    editor = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(editor),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'org'
        }
      },
      { acl: editor }
    );

    organization = createOrganizationAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        agent: getId(editor),
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          editor: {
            roleName: 'editor',
            editor: getId(editor)
          },
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            editor,
            { createGraphPermission: true, publicReadPermission: true }
          )
        }
      },
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;

    const createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(editor),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'WorkflowSpecification',
          expectedDuration: 'P60D',
          potentialAction: {
            '@type': 'CreateGraphAction',
            agent: {
              '@type': 'Role',
              roleName: 'author'
            },
            participant: ALL_AUDIENCES,
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: getDefaultGraphDigitalDocumentPermissions(),
              // Submission stage
              potentialAction: {
                '@id': '_:submissionStage',
                '@type': 'StartWorkflowStageAction',
                name: 'Submission Stage',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@type': 'CreateReleaseAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'author'
                    },
                    completeOn: 'OnEndorsed',
                    participant: [
                      { '@type': 'Audience', audienceType: 'author' }
                    ],
                    potentialAction: [
                      {
                        '@type': 'AuthorizeAction',
                        completeOn: 'OnObjectStagedActionStatus',
                        actionStatus: 'PotentialActionStatus',
                        recipient: [
                          {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        ]
                      },
                      {
                        '@type': 'AuthorizeAction',
                        completeOn: 'OnObjectCompletedActionStatus',
                        actionStatus: 'PotentialActionStatus',
                        recipient: [
                          {
                            '@type': 'Audience',
                            audienceType: 'producer'
                          }
                        ]
                      },
                      {
                        '@type': 'EndorseAction',
                        activateOn: 'OnObjectStagedActionStatus',
                        actionStatus: 'PotentialActionStatus',
                        agent: {
                          '@type': 'ContributorRole',
                          roleName: 'editor'
                        },
                        participant: [
                          {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      { acl: editor }
    );

    const workflowSpecification = createWorkflowSpecificationAction.result;

    defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');
  });

  it('should handle trigger errors (non endorse case, triggered action are executed before the triggering action so that triggering action is intact)', async () => {
    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            author: author['@id']
          }
        }
      }),
      { acl: author, skipPayments: true }
    );

    const graph = createGraphAction.result;

    let createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    let authorizeAction = arrayify(graph.potentialAction).find(
      action =>
        action['@type'] === 'AuthorizeAction' &&
        action.completeOn === 'OnObjectStagedActionStatus'
    );

    // we monkey patch the AuthorizeAction so that it fails when we POST the staged CreateReleaseAction
    authorizeAction = await librarian.put(
      Object.assign({}, authorizeAction, {
        recipient: [{ '@type': 'Audience' }] // this is to trigger an error
      }),
      { force: true }
    );

    // trigger failure:
    await assert.rejects(
      librarian.post(
        Object.assign({}, createReleaseAction, {
          actionStatus: 'StagedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      ),
      {
        code: ERROR_CODE_TRIGGERED_ACTION
      }
    );
  });

  it('should handle trigger errors (endorse case, endorse should succeed but triggered action should error (but be in EndorsedActionStatus))', async () => {
    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            author: author['@id']
          }
        }
      }),
      { acl: author, skipPayments: true }
    );

    const graph = createGraphAction.result;

    let createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    // trigger the endorse action
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    let endorseAction = await arrayify(
      createReleaseAction.potentialAction
    ).find(action => action['@type'] === 'EndorseAction');

    // we ensure that the CreateReleaseAction will fail when we POST the completed endorse action
    const lock = await librarian.createLock(
      createId('release', 'latest', graph)['@id'],
      {
        prefix: 'release',
        isLocked: null
      }
    );

    const store = new Store();
    await assert.rejects(
      librarian.post(
        Object.assign({}, endorseAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0])
        }),
        { acl: editor, store }
      ),
      {
        code: ERROR_CODE_TRIGGERED_ACTION
      }
    );

    // check that the endorse did complete
    endorseAction = store.get(endorseAction);
    assert.equal(endorseAction.actionStatus, 'CompletedActionStatus');
    createReleaseAction = store.get(createReleaseAction);
    assert.equal(createReleaseAction.actionStatus, 'EndorsedActionStatus');

    // release lock so that we can retry
    await lock.unlock();

    // check that the author can recover from that error and manually complete the CRA
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    assert.equal(createReleaseAction.actionStatus, 'CompletedActionStatus');
  });
});
