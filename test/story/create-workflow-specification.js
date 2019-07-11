import { createId, ALL_AUDIENCES } from '../../src';

export default function cretateWorkflowSpecification(ORG_ID) {
  const WORKFLOW_SPECIFICATION_ID = createId('workflow')['@id'];

  const SUBMISSION_STAGE_ID = createId('blank')['@id'];
  const SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID = createId('blank')['@id'];
  const TYPESETTING_SERVICE_ID = createId('service', null, ORG_ID)['@id'];

  const SUBMISSION_STAGE_DECLARE_ACTION_ID = createId('blank')['@id'];
  const SUBMISSION_STAGE_REVIEW_ACTION_ID = createId('blank')['@id'];
  const SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID = createId('blank')['@id'];

  const SUBMISSION_STAGE_ASSESS_ACTION_ID = createId('blank')['@id'];
  const SUBMISSION_STAGE_REJECT_ACTION_ID = createId('blank')['@id'];

  const ENDORSE_ACTION_ID = createId('blank')['@id'];

  const PRODUCTION_STAGE_ID = createId('blank')['@id'];
  const PRODUCTION_STAGE_PUBLISH_ACTION_ID = createId('blank')['@id'];

  const workflowSpecification = {
    '@id': WORKFLOW_SPECIFICATION_ID,
    '@type': 'WorkflowSpecification',
    expectedDuration: 'P60D',
    potentialAction: {
      '@type': 'CreateGraphAction',
      result: {
        '@type': 'Graph',
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: ALL_AUDIENCES
          },
          // blinding
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ViewIdentityPermission',
            grantee: ALL_AUDIENCES,
            permissionScope: ALL_AUDIENCES
          }
        ],

        potentialAction: {
          '@id': SUBMISSION_STAGE_ID,
          '@type': 'StartWorkflowStageAction',
          name: 'Submission stage',
          actionStatus: 'PotentialActionStatus',
          participant: ALL_AUDIENCES,

          result: [
            {
              '@id': SUBMISSION_STAGE_DECLARE_ACTION_ID,
              '@type': 'DeclareAction',
              actionStatus: 'ActiveActionStatus',
              agent: {
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
              question: {
                '@type': 'Question',
                text: 'q1'
              },
              potentialAction: {
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
              }
            },
            {
              '@id': SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID,
              '@type': 'CreateReleaseAction',
              actionStatus: 'ActiveActionStatus',
              agent: {
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
                },
                {
                  '@type': 'Audience',
                  audienceType: 'reviewer'
                }
              ],
              potentialService: {
                '@id': TYPESETTING_SERVICE_ID
              },
              requiresCompletionOf: SUBMISSION_STAGE_DECLARE_ACTION_ID,
              result: {
                '@type': 'Graph',
                potentialAction: [
                  {
                    '@id': SUBMISSION_STAGE_REVIEW_ACTION_ID,
                    '@type': 'ReviewAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'reviewer'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    minInstances: 1,
                    maxInstances: 3,
                    answer: [
                      {
                        '@type': 'Answer',
                        parentItem: {
                          '@type': 'Question',
                          text: 'q1'
                        }
                      },
                      {
                        '@type': 'Answer',
                        parentItem: {
                          '@type': 'Question',
                          text: 'q2'
                        }
                      }
                    ],
                    completeOn: 'OnEndorsed',
                    potentialAction: [
                      {
                        '@id': ENDORSE_ACTION_ID,
                        '@type': 'EndorseAction',
                        activateOn: 'OnObjectStagedActionStatus',
                        agent: {
                          '@type': 'ContributorRole',
                          roleName: 'author'
                        },
                        participant: {
                          '@type': 'Audience',
                          audienceType: 'author'
                        }
                      },
                      {
                        '@type': 'AuthorizeAction',
                        completeOn: 'OnObjectStagedActionStatus', // Note that this has to match the activation of the EndorseAction so that then endorser has access
                        actionStatus: 'PotentialActionStatus',
                        recipient: {
                          '@type': 'Audience',
                          audienceType: 'author'
                        }
                      }
                    ]
                  },
                  {
                    '@id': SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID,
                    '@type': 'ReviewAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    minInstances: 1,
                    maxInstances: 1,
                    answer: [
                      {
                        '@type': 'Answer',
                        parentItem: {
                          '@type': 'Question',
                          text: 'q1'
                        }
                      },
                      {
                        '@type': 'Answer',
                        parentItem: {
                          '@type': 'Question',
                          text: 'q2'
                        }
                      }
                    ]
                  },
                  {
                    '@id': SUBMISSION_STAGE_ASSESS_ACTION_ID,
                    '@type': 'AssessAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'reviewer'
                      }
                    ],
                    requiresCompletionOf: [
                      SUBMISSION_STAGE_REVIEW_ACTION_ID,
                      SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID
                    ],
                    potentialResult: [
                      {
                        '@id': SUBMISSION_STAGE_REJECT_ACTION_ID,
                        '@type': 'RejectAction',
                        actionStatus: 'PotentialActionStatus',
                        agent: {
                          roleName: 'editor'
                        }
                      },

                      {
                        '@id': PRODUCTION_STAGE_ID,
                        '@type': 'StartWorkflowStageAction',
                        actionStatus: 'PotentialActionStatus',
                        name: 'Production stage',
                        participant: ALL_AUDIENCES,
                        result: {
                          '@id': PRODUCTION_STAGE_PUBLISH_ACTION_ID,
                          '@type': 'PublishAction',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        }
                      }
                    ],

                    potentialAction: [
                      {
                        '@type': 'AuthorizeAction',
                        completeOn: 'OnWorkflowStageEnd',
                        actionStatus: 'PotentialActionStatus',
                        recipient: {
                          '@type': 'Audience',
                          audienceType: 'author'
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      }
    }
  };

  return {
    workflowSpecification,

    WORKFLOW_SPECIFICATION_ID,
    SUBMISSION_STAGE_ID,
    SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID,
    TYPESETTING_SERVICE_ID,
    SUBMISSION_STAGE_DECLARE_ACTION_ID,
    SUBMISSION_STAGE_REVIEW_ACTION_ID,
    SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID,
    SUBMISSION_STAGE_ASSESS_ACTION_ID,
    SUBMISSION_STAGE_REJECT_ACTION_ID,
    ENDORSE_ACTION_ID,
    PRODUCTION_STAGE_ID,
    PRODUCTION_STAGE_PUBLISH_ACTION_ID
  };
}
