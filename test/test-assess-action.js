import assert from 'assert';
import noop from 'lodash/noop';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('AssessAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    periodical,
    organization,
    graph,
    workflowSpecification,
    assessAction,
    reviewAction;

  beforeEach(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'org'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    const createPeriodicalAciton = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          editor: {
            roleName: 'editor',
            editor: user['@id']
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
              grantee: user['@id']
            }
          ]
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAciton.result;
    // console.log(require('util').inspect(periodical, { depth: null }));

    const createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(user),
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
                result: [
                  {
                    '@id': '_:reviewAction',
                    '@type': 'ReviewAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      '@type': 'Role',
                      roleName: 'editor'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    }
                  },
                  {
                    '@type': 'AssessAction',
                    actionStatus: 'ActiveActionStatus',
                    name: 'pre-screening',
                    agent: { '@type': 'Role', roleName: 'editor' },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    requiresCompletionOf: '_:reviewAction',
                    potentialResult: [
                      {
                        '@type': 'StartWorkflowStageAction',
                        actionStatus: 'PotentialActionStatus',
                        participant: ALL_AUDIENCES,
                        result: {
                          '@type': 'CreateReleaseAction',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            '@type': 'Role',
                            roleName: 'author'
                          },
                          participant: [
                            {
                              '@type': 'Audience',
                              audienceType: 'author'
                            },
                            {
                              '@type': 'Audience',
                              audienceType: 'editor'
                            }
                          ],
                          result: {
                            '@type': 'Graph',
                            potentialAction: {
                              '@type': 'DeclareAction',
                              actionStatus: 'ActiveActionStatus',
                              agent: {
                                '@type': 'Role',
                                roleName: 'author'
                              },
                              participant: {
                                '@type': 'Audience',
                                audienceType: 'author'
                              },
                              potentialAction: {
                                '@type': 'AuthorizeAction',
                                actionStatus: 'PotentialActionStatus',
                                completeOn: 'OnObjectCompletedActionStatus',
                                recipient: {
                                  '@type': 'Audience',
                                  audienceType: 'editor'
                                }
                              }
                            }
                          }
                        }
                      },
                      {
                        '@type': 'RejectAction',
                        actionStatus: 'PotentialActionStatus',
                        agent: { '@type': 'Role', roleName: 'editor' }
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      { acl: user }
    );

    workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      arrayify(workflowSpecification.potentialAction)
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: { roleName: 'author', agent: user['@id'] },
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(user)
          },
          editor: getId(arrayify(periodical.editor)[0])
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    assessAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'AssessAction'
    );

    reviewAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'ReviewAction'
    );
  });

  it('should complete an AssessAction and instantiate the StartWorkflowStageAction branch', async () => {
    // console.log(
    //   require('util').inspect({ workflowSpecification, graph }, { depth: null })
    // );

    assessAction = Object.assign({}, assessAction, {
      agent: getId(arrayify(graph.editor)[0]),
      actionStatus: 'CompletedActionStatus',
      result: getId(
        arrayify(assessAction.potentialResult).find(
          result => result['@type'] === 'StartWorkflowStageAction'
        )
      )
    });

    reviewAction = Object.assign({}, reviewAction, {
      agent: getId(arrayify(graph.editor)[0]),
      actionStatus: 'CompletedActionStatus',
      resultReview: {
        '@type': 'Review',
        reviewBody: 'review'
      }
    });

    try {
      await librarian.post(assessAction, { acl: user });
    } catch (err) {
      var f = () => {
        throw err;
      };
    } finally {
      assert.throws(
        f || noop,
        Error,
        'need to complete review to be able to perform assessment'
      );
    }

    reviewAction = await librarian.post(reviewAction, { acl: user });

    assessAction = await librarian.post(assessAction, { acl: user });

    assert.equal(assessAction.actionStatus, 'CompletedActionStatus');

    // test that worfklow stage has been unfolded
    graph = await librarian.get(getId(graph), {
      acl: user,
      potentialActions: 'all'
    });

    const stage = arrayify(graph.potentialAction).find(
      action =>
        action['@type'] === 'StartWorkflowStageAction' &&
        getId(action.resultOf) === getId(assessAction)
    );

    // console.log(require('util').inspect(graph, { depth: null }));
    const createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    const declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );

    reviewAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'ReviewAction'
    );

    assert(
      stage.endTime === stage.startTime &&
        new Date(stage.endTime).getTime() >
          new Date(assessAction.endTime).getTime(),
      'stage starts after the action spawning it'
    );

    assert(createReleaseAction, 'createReleaseAction has been unfolded');
    assert.equal(
      createReleaseAction.actionStatus,
      'ActiveActionStatus',
      'createReleaseAction is active'
    );

    // Check that identifier where added
    assert.equal(stage.identifier, '1');
    assert.equal(createReleaseAction.identifier, '1.0');
    assert.equal(declareAction.identifier, '1.1');
  });

  it('should complete an AsessAction and unfold the RejectAction branch', async () => {
    // we need to complete review action first to be able to reject
    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus',
        resultReview: {
          '@type': 'Review',
          reviewBody: 'review'
        }
      }),
      { acl: user }
    );

    // reject
    assessAction = await librarian.post(
      Object.assign({}, assessAction, {
        agent: getId(arrayify(graph.editor)[0]),
        result: getId(
          arrayify(assessAction.potentialResult).find(
            result => result['@type'] === 'RejectAction'
          )
        ),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: user }
    );

    // console.log(require('util').inspect(assessAction, { depth: null }));

    assert.equal(
      assessAction.actionStatus,
      'CompletedActionStatus',
      'Reject action is marked as completed'
    );

    // check that date rejected was added to the Graph
    graph = await librarian.get(getId(graph), {
      acl: user,
      potentialActions: 'all'
    });

    // check that roles were terminated
    assert(
      arrayify(graph.author).every(
        role => role.endDate === assessAction.endTime
      )
    );

    assert(graph.dateRejected);
  });
});
