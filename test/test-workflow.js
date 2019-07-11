import assert from 'assert';
import uuid from 'uuid';
import omit from 'lodash/omit';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('workflow', function() {
  this.timeout(40000);

  const librarian = new Librarian({ skipPayments: true });
  let author,
    editor,
    producer,
    reviewer,
    periodical,
    organization,
    workflowSpecification,
    graph;

  before(async () => {
    [author, editor, producer, reviewer] = await Promise.all(
      ['author', 'editor', 'producer', 'reviewer'].map(name => {
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
        agent: getId(editor),
        actionStatus: 'CompletedActionStatus',
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
          ]
        }
      },
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;

    // Add producer
    const inviteProducerAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        recipient: {
          roleName: 'producer',
          recipient: getId(producer)
        },
        object: getId(periodical)
      },
      { acl: editor }
    );

    const acceptInviteProducerActionAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(producer),
        object: getId(inviteProducerAction)
      },
      { acl: producer }
    );

    periodical = acceptInviteProducerActionAction.result.result;

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
              hasDigitalDocumentPermission: [
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
                },
                {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'WritePermission',
                  grantee: [
                    {
                      '@type': 'Audience',
                      audienceType: 'author'
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'reviewer'
                    }
                  ]
                }
              ],
              // Submission stage
              potentialAction: {
                '@id': '_:submissionStage',
                '@type': 'StartWorkflowStageAction',
                name: 'Submission Stage',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@id': '_:declareAction',
                    '@type': 'DeclareAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'author'
                    },
                    participant: ALL_AUDIENCES,
                    name: 'Ethical compliance'
                  },

                  {
                    '@type': 'CreateReleaseAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'author'
                    },
                    participant: ALL_AUDIENCES,
                    name: 'send to editor',
                    requiresCompletionOf: ['_:declareAction'],
                    result: {
                      '@type': 'Graph',
                      potentialAction: {
                        '@id': '_:submissionAssessAction',
                        '@type': 'AssessAction',
                        actionStatus: 'ActiveActionStatus',
                        name: 'pre-screening',
                        agent: {
                          roleName: 'editor'
                        },
                        participant: ALL_AUDIENCES,
                        potentialResult: [
                          '_:submissionStage',
                          {
                            '@id': '_:rejectAction',
                            '@type': 'RejectAction',
                            actionStatus: 'PotentialActionStatus',
                            agent: {
                              roleName: 'editor'
                            },
                            participant: ALL_AUDIENCES
                          },

                          // Peer review stage
                          {
                            '@type': 'StartWorkflowStageAction',
                            actionStatus: 'PotentialActionStatus',
                            name: 'Peer review stage',
                            participant: ALL_AUDIENCES,
                            result: [
                              {
                                '@id': '_:reviewAction',
                                '@type': 'ReviewAction',
                                actionStatus: 'ActiveActionStatus',
                                agent: {
                                  roleName: 'reviewer'
                                },
                                participant: {
                                  '@type': 'Audience',
                                  audienceType: 'editor'
                                },
                                completeOn: 'OnEndorsed',
                                name: 'data availability',
                                potentialAction: [
                                  {
                                    '@type': 'AuthorizeAction',
                                    completeOn: 'OnWorkflowStageEnd',
                                    actionStatus: 'PotentialActionStatus',
                                    recipient: [
                                      {
                                        '@type': 'Audience',
                                        audienceType: 'editor'
                                      },
                                      {
                                        '@type': 'Audience',
                                        audienceType: 'producer'
                                      }
                                    ]
                                  },
                                  {
                                    '@id': '_:endorseAction',
                                    '@type': 'EndorseAction',
                                    actionStatus: 'PotentialActionStatus',
                                    activateOn: 'OnObjectStagedActionStatus',
                                    agent: { roleName: 'editor' },
                                    participant: {
                                      '@type': 'Audience',
                                      audienceType: 'editor'
                                    }
                                  }
                                ]
                              },

                              {
                                '@id': '_:assessAction',
                                '@type': 'AssessAction',
                                actionStatus: 'ActiveActionStatus',
                                agent: {
                                  roleName: 'editor'
                                },
                                participant: ALL_AUDIENCES,
                                requiresCompletionOf: ['_:reviewAction'],
                                potentialResult: [
                                  // Production stage
                                  {
                                    '@id': '_:productionStage',
                                    '@type': 'StartWorkflowStageAction',
                                    actionStatus: 'PotentialActionStatus',
                                    participant: ALL_AUDIENCES,
                                    result: {
                                      '@type': 'PublishAction',
                                      actionStatus: 'ActiveActionStatus',
                                      agent: {
                                        roleName: 'editor'
                                      },
                                      participant: ALL_AUDIENCES
                                    }
                                  },
                                  '_:rejectAction'
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    }
                  }
                ]
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

    graph = createGraphAction.result;

    // Add reviewer
    const inviteReviewerAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: {
          roleName: 'reviewer',
          recipient: getId(reviewer)
        },
        object: getId(graph)
      },
      { acl: editor }
    );
    const acceptInviteReviewerAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(reviewer),
        object: getId(inviteReviewerAction)
      },
      { acl: reviewer }
    );
    graph = acceptInviteReviewerAction.result.result;
  });

  it('should have created a Graph and unfolded 3 potential workflow actions', async () => {
    graph = await librarian.get(graph, {
      acl: author,
      potentialActions: true
    });

    const startWorkflowStageAction = graph.potentialAction.find(
      action => action['@type'] === 'StartWorkflowStageAction'
    );
    assert.equal(
      startWorkflowStageAction.actionStatus,
      'CompletedActionStatus',
      'the stage was unfolded'
    );

    const declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );
    assert.equal(
      declareAction.actionStatus,
      'ActiveActionStatus',
      'action of the stage was unfolded'
    );

    const createReleaseAction = graph.potentialAction.find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    assert.equal(
      createReleaseAction.actionStatus,
      'ActiveActionStatus',
      'action of the stage was unfolded'
    );
  });

  it('should unfold the workflow', async () => {
    graph = await librarian.get(graph, {
      acl: author,
      potentialActions: true
    });
    // console.log(require('util').inspect(graph, { depth: null }));

    // complete the DeclareAction so that we can execute the CreateReleaseAction
    let declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );

    declareAction = await librarian.post(
      Object.assign({}, declareAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );
    assert.equal(declareAction.actionStatus, 'CompletedActionStatus');

    // check that stage has been updated
    const stage = await librarian.get(getId(declareAction.resultOf), {
      acl: author,
      potentialActions: false
    });

    // console.log(require('util').inspect(stage, { depth: null }));
    const updatedStageDeclareAction = stage.result.find(
      action => getId(action) === getId(declareAction)
    );
    assert.equal(
      updatedStageDeclareAction.actionStatus,
      'CompletedActionStatus',
      'stage is kept up-to-date'
    );

    let createReleaseAction = graph.potentialAction.find(
      action => action['@type'] === 'CreateReleaseAction'
    );
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );
    assert.equal(createReleaseAction.actionStatus, 'CompletedActionStatus');

    // get the potential action of the release
    const release = await librarian.get(createReleaseAction.result, {
      acl: author,
      potentialActions: true
    });

    assert.equal(release.potentialAction.length, 1, 'AssessAction is here');

    let assessAction = release.potentialAction.find(
      action => action['@type'] === 'AssessAction'
    );
    assert(assessAction.startTime, 'startTime was added');
    // console.log(require('util').inspect(assessAction, { depth: null }));

    // Send the submission to the peer review stage
    const result = assessAction.potentialResult.find(
      result => result.name === 'Peer review stage'
    );

    assessAction = await librarian.post(
      Object.assign({}, assessAction, {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus',
        result: getId(result)
      }),
      { acl: editor }
    );
    assert.equal(assessAction.actionStatus, 'CompletedActionStatus');
    // console.log(require('util').inspect(assessAction, { depth: null }));

    assessAction = await librarian.get(assessAction, {
      acl: editor,
      potentialActions: true
    });

    // get review stage
    const reviewStage = await librarian.get(assessAction.result, {
      acl: editor,
      potentialActions: false
    });
    //console.log(require('util').inspect(reviewStage, { depth: null }));

    let reviewAction = reviewStage.result.find(
      result => result['@type'] === 'ReviewAction'
    );

    // assign review action to reviewer
    const assignAction = await librarian.post(
      {
        '@type': 'AssignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: getId(arrayify(graph.reviewer)[0]),
        object: getId(reviewAction)
      },
      { acl: editor }
    );
    // console.log(require('util').inspect(assignAction, { depth: null }));

    reviewAction = await librarian.get(reviewAction, {
      acl: reviewer,
      potentialActions: false
    });

    //  Mark review action as staged as reviewer to unfold the EndorseAction
    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        agent: getId(arrayify(graph.reviewer)[0]),
        actionStatus: 'StagedActionStatus',
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

    assert.equal(reviewAction.actionStatus, 'StagedActionStatus');
    // console.log(require('util').inspect(reviewAction, { depth: null }));

    // check that ReviewAction instrument points to the right createReleaseAction + assessAction
    assert.deepEqual(
      arrayify(reviewAction.instrument)
        .slice()
        .sort(),
      [getId(createReleaseAction), getId(assessAction)].sort()
    );

    // check that EndorseAction has been activated

    reviewAction = await librarian.get(reviewAction, {
      acl: reviewer,
      potentialActions: true
    });
    // console.log(require('util').inspect(reviewAction, { depth: null }));

    let endorseAction = reviewAction.potentialAction.find(
      action => action['@type'] === 'EndorseAction'
    );
    assert.equal(endorseAction.actionStatus, 'ActiveActionStatus');

    // editor endorse review
    endorseAction = await librarian.post(
      Object.assign({}, endorseAction, {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: editor }
    );
    // console.log(require('util').inspect(endorseAction, { depth: null }));
    assert.equal(endorseAction.actionStatus, 'CompletedActionStatus');

    reviewAction = endorseAction.result;

    // check that the endorsement marked the review as completed
    reviewAction = await librarian.get(reviewAction, { acl: reviewer });
    // console.log(require('util').inspect(reviewAction, { depth: null }));

    assert.equal(reviewAction.actionStatus, 'CompletedActionStatus');

    // Editor assess
    assessAction = reviewStage.result.find(
      result => result['@type'] === 'AssessAction'
    );

    assessAction = await librarian.post(
      Object.assign({}, omit(assessAction, ['potentialAction']), {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus',
        result: getId(
          assessAction.potentialResult.find(
            result => result['@type'] === 'StartWorkflowStageAction'
          )
        )
      }),
      { acl: editor }
    );
    // console.log(require('util').inspect(assessAction, { depth: null }));
    assert.equal(assessAction.actionStatus, 'CompletedActionStatus');

    // fetch the graph again to check what has been unfolded
    //    graph = await librarian.get(graph, {
    //      acl: false,
    //      potentialActions: 'all'
    //    });
    //    console.log(
    //      require('util').inspect(
    //        arrayify(graph.potentialAction).map(action => {
    //          return require('lodash/pick')(action, ['@type', 'object']);
    //        }),
    //        { depth: null }
    //      )
    //    );

    // Check that audience of the review action have been extended as specified by the potential authorize action
    reviewAction = await librarian.get(reviewAction, {
      acl: editor,
      potentialActions: true
    });
    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert(
      reviewAction.participant.some(
        participant =>
          participant.participant &&
          participant.participant.audienceType === 'producer'
      )
    );
  });
});
