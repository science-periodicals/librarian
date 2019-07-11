import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getAgentId } from '../src/';

describe('EndorseAction', function() {
  this.timeout(40000);

  let librarian,
    editor,
    author,
    organization,
    periodical,
    workflowSpecification,
    graph;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [editor, author] = await Promise.all(
      ['editor', 'author'].map(id => {
        return registerUser();
      })
    );

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
        agent: editor['@id'],
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          author: {
            roleName: 'author',
            author: editor
          },
          editor: {
            roleName: 'editor',
            editor: editor
          },
          hasDigitalDocumentPermission: [
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'CreateGraphPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'user'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'editor'
              }
            }
          ].concat(
            ['reviewer', 'author', 'producer'].map(audienceType => {
              return {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType
                }
              };
            })
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
        object: getId(periodical),
        result: {
          '@type': 'WorkflowSpecification',
          expectedDuration: 'P60D',
          potentialAction: {
            '@type': 'CreateGraphAction',
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: [
                'editor',
                'reviewer',
                'author',
                'producer'
              ].map(audienceType => {
                return {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'AdminPermission',
                  grantee: {
                    '@type': 'Audience',
                    audienceType
                  }
                };
              }),
              potentialAction: {
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: {
                  '@type': 'ReviewAction',
                  agent: { roleName: 'author' },
                  participant: {
                    '@type': 'Audience',
                    audienceType: 'editor'
                  },
                  completeOn: 'OnEndorsed',
                  actionStatus: 'ActiveActionStatus',
                  potentialAction: {
                    '@id': '_:endorseActionId',
                    '@type': 'EndorseAction',
                    activateOn: 'OnObjectStagedActionStatus',
                    agent: {
                      '@type': 'ContributorRole',
                      roleName: 'editor'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    }
                  }
                }
              }
            }
          }
        }
      },
      { acl: editor }
    );
    workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: author['@id'],
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: author['@id']
          },
          editor: getId(arrayify(periodical.editor)[0])
        }
      }),
      { acl: author, skipPayments: true }
    );

    graph = createGraphAction.result;

    // console.log(require('util').inspect(graph, { depth: null }));
  });

  it('should endorse an action', async () => {
    // the author complete the review action but as it needs endorsement it goes into `StagedActionStatus`
    let reviewAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'ReviewAction'
    );

    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        resultReview: {
          '@type': 'Review',
          reviewBody: 'Overall it fits well',
          reviewRating: {
            '@type': 'Rating',
            bestRating: '5',
            ratingValue: '4',
            worstRating: '1'
          }
        }
      }),
      { acl: author }
    );

    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert.equal(reviewAction.actionStatus, 'StagedActionStatus');

    let endorseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'EndorseAction'
    );

    // check that endorse has an identifier
    assert.equal(endorseAction.identifier, '0.0.e');

    // the editor endorse it
    endorseAction = await librarian.post(
      Object.assign({}, endorseAction, {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: editor }
    );

    // console.log(require('util').inspect(endorseAction, { depth: null }));
    assert.equal(endorseAction.result.actionStatus, 'CompletedActionStatus');
    assert(endorseAction.result.endorsedTime);
    assert(
      endorseAction.result.participant.some(
        participant =>
          participant.roleName === 'endorser' &&
          getAgentId(participant) === getAgentId(arrayify(graph.editor)[0])
      ),
      'the endorser was set'
    );
  });
});
