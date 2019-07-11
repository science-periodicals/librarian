import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getAgentId } from '../src/';

describe('UnassignAction', function() {
  this.timeout(40000);

  let librarian,
    editor,
    author,
    reviewer,
    organization,
    periodical,
    graph,
    reviewAction,
    declareAction;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    editor = await registerUser();
    author = await registerUser();
    reviewer = await registerUser();

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
        agent: {
          roleName: 'editor',
          agent: editor['@id']
        },
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
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
              grantee: [
                {
                  '@type': 'Audience',
                  audienceType: 'editor'
                },
                {
                  '@type': 'Audience',
                  audienceType: 'producer'
                }
              ]
            }
          ].concat(
            ['editor', 'reviewer', 'author', 'producer'].map(audienceType => {
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
        agent: editor['@id'],
        object: periodical['@id'],
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
                result: [
                  {
                    '@type': 'ReviewAction',
                    expectedDuration: 'P2D',
                    agent: { '@type': 'Role', roleName: 'reviewer' },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    }
                  },
                  {
                    '@type': 'DeclareAction',
                    expectedDuration: 'P2D',
                    agent: { '@type': 'Role', roleName: 'author' },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'author'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
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

    //console.log(
    //  require('util').inspect(createPeriodicalAction, {
    //    depth: null
    //  })
    //);

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        object: workflowSpecification['@id'],
        agent: author['@id'],
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            agent: author['@id']
          }
        }
      }),
      { acl: author['@id'], skipPayments: true }
    );

    graph = createGraphAction.result;

    // add reviewer to graph
    const graphInviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'ActiveActionStatus',
        recipient: {
          roleName: 'reviewer',
          recipient: reviewer['@id']
        },
        object: graph['@id']
      },
      { acl: editor['@id'] }
    );

    const graphAcceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: reviewer['@id'],
        object: graphInviteAction['@id']
      },
      { acl: reviewer['@id'] }
    );

    // console.log(require('util').inspect(graph, { depth: null }));

    reviewAction = graph.potentialAction.find(
      action => action['@type'] === 'ReviewAction'
    );

    declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );

    // !! `graphAcceptAction.result.result` won't contain @graph and potential action but will contain the latest contributor (reviewer here)
    graph = graphAcceptAction.result.result;

    // update review action
    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        agent: getId(arrayify(graph.reviewer)[0]),
        resultReview: {
          '@type': 'Review',
          reviewBody: 'All good',
          reviewRating: {
            '@type': 'Rating',
            bestRating: 5,
            ratingValue: 4,
            worstRating: 1
          }
        }
      }),
      { acl: reviewer }
    );

    await librarian.post(
      {
        '@type': 'AssignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: getId(arrayify(graph.reviewer)[0]),
        object: getId(reviewAction)
      },
      { acl: editor }
    );
  });

  it('should unassign a ReviewAction and reset it as it has no other audiences than the agent', async () => {
    // console.log(require('util').inspect(reviewAction, { depth: null }));

    // unassign
    const unassignAction = await librarian.post(
      {
        '@type': 'UnassignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        object: getId(reviewAction)
      },
      { acl: editor }
    );

    // console.log(require('util').inspect(unassignAction, { depth: null }));

    const unassignedReviewAction = unassignAction.result;

    assert.deepEqual(
      unassignAction.result.agent,
      unassignedReviewAction.agent,
      'template agent was brought back'
    );

    assert(
      unassignedReviewAction.participant.every(participant => {
        return participant.roleName !== 'assigner';
      }),
      'assigner was removed'
    );

    assert(
      unassignedReviewAction.participant.some(participant => {
        return participant.roleName === 'unassigner';
      }),
      'unassigner was added'
    );

    // check that review was reseted...
    assert(
      !unassignedReviewAction.resultReview ||
        !unassignedReviewAction.resultReview.reviewBody
    );
    //  ...but that the instantiated review @id was preserved
    assert.equal(
      getId(unassignedReviewAction.resultReview),
      getId(reviewAction.resultReview)
    );
  });

  it('should error when unassigning an unassigned action', async () => {
    await assert.rejects(
      librarian.post(
        {
          '@type': 'UnassignAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          object: getId(declareAction)
        },
        { acl: editor }
      ),
      { code: 400, message: /unassigned/ }
    );
  });

  it('should not delete the agent on unassign', async () => {
    const assignAction = await librarian.post(
      {
        '@type': 'AssignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: getId(arrayify(graph.author)[0]),
        object: getId(declareAction)
      },
      { acl: editor }
    );

    const unassignAction = await librarian.post(
      {
        '@type': 'UnassignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        object: getId(declareAction)
      },
      { acl: editor }
    );

    assert(
      unassignAction.result.participant.every(participant => {
        return participant.roleName !== 'assigner';
      }),
      'assigner was removed'
    );

    assert(
      unassignAction.result.participant.some(participant => {
        return participant.roleName === 'unassigner';
      }),
      'unassigner was added'
    );

    assert(getAgentId(unassignAction.result.agent), 'agent was preserved');
  });
});
