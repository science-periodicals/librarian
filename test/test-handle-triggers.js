import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getAgent } from '../src';

// See also test-post.js for triggers errors handling
describe('handle-triggers (special cases)', function() {
  this.timeout(40000);

  let librarian, editor, author, producer, organization, periodical;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [editor, author, producer] = await Promise.all([
      registerUser(),
      registerUser(),
      registerUser()
    ]);

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
        actionStatus: 'CompletedActionStatus',
        agent: editor['@id'],
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          editor: {
            roleName: 'editor',
            editor: getId(editor)
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
              permissionType: 'ReadPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: [editor['@id']]
            }
          ]
        }
      },
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;

    const inviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(author),
        recipient: {
          roleName: 'producer',
          recipient: getId(producer)
        },
        object: getId(periodical)
      },
      { acl: editor }
    );

    // make the recipient accept the invite
    const acceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(producer),
        object: getId(inviteAction)
      },
      { acl: producer }
    );
    periodical = acceptAction.result.result;
  });

  it('should execute previous staged triggers when action is completed but was never staged before', async () => {
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
                '@id': '_:stage',
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: {
                  '@type': 'CreateReleaseAction',
                  actionStatus: 'ActiveActionStatus',
                  agent: {
                    '@type': 'ContributorRole',
                    roleName: 'author'
                  },
                  participant: [
                    {
                      '@type': 'Audience',
                      audienceType: 'author'
                    }
                  ],
                  potentialAction: [
                    {
                      '@type': 'AuthorizeAction',
                      actionStatus: 'PotentialActionStatus',
                      completeOn: 'OnObjectStagedActionStatus',
                      recipient: {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      }
                    },
                    {
                      '@type': 'AuthorizeAction',
                      actionStatus: 'PotentialActionStatus',
                      completeOn: 'OnObjectCompletedActionStatus',
                      recipient: {
                        '@type': 'Audience',
                        audienceType: 'producer'
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      },
      { acl: editor }
    );

    const workflowSpecification = createWorkflowSpecificationAction.result;

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
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            author: getId(author)
          }
        }
      }),
      { acl: author, skipPayments: true }
    );

    let graph = createGraphAction.result;

    // add a producer
    const inviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: {
          roleName: 'producer',
          recipient: getId(producer)
        },
        object: getId(graph)
      },
      { acl: editor }
    );

    // make the recipient accept the invite
    const acceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(producer),
        object: getId(inviteAction)
      },
      { acl: producer }
    );

    graph = Object.assign({}, acceptAction.result.result, {
      potentialAction: graph.potentialAction
    });

    // Complete the create release action (without staging it before)
    let createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    assert.deepEqual(getAudienceTypes(createReleaseAction).sort(), ['author']);

    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        result: {
          '@type': 'Graph',
          mainEntity: '_:article',
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'ScholarlyArticle'
            }
          ]
        }
      }),
      { acl: author }
    );

    // check that `editor` where added (so that trigger on staged was triggered by completing the action)
    assert.deepEqual(getAudienceTypes(createReleaseAction).sort(), [
      'author',
      'editor',
      'producer'
    ]);
  });
});

function getAudienceTypes(action) {
  const audienceTypes = new Set();
  arrayify(action.participant).forEach(participant => {
    participant = getAgent(participant);
    if (participant && participant.audienceType) {
      audienceTypes.add(participant.audienceType);
    }
  });
  return Array.from(audienceTypes);
}
