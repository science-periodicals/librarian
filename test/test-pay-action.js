import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

// TODO test with payment token triggering errors (see https://stripe.com/docs/connect/testing)

describe('PayAction', function() {
  this.timeout(40000);

  const librarian = new Librarian({ skipPayments: true });

  describe('Simple PayAction', () => {
    let author, editor, periodical, organization, workflowSpecification, graph;

    before(async () => {
      [author, editor] = await Promise.all(
        ['author', 'editor'].map(name => {
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
                      '@type': 'PayAction',
                      actionStatus: 'ActiveActionStatus',
                      name: 'Article processing charge',
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
                      priceSpecification: {
                        '@type': 'PriceSpecification',
                        price: 0,
                        priceCurrency: 'USD'
                      }
                    },
                    {
                      '@type': 'CreateReleaseAction',
                      actionStatus: 'ActiveActionStatus',
                      agent: {
                        roleName: 'author'
                      },
                      participant: ALL_AUDIENCES,
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
                            {
                              '@id': '_:rejectAction',
                              '@type': 'RejectAction',
                              actionStatus: 'PotentialActionStatus',
                              agent: {
                                roleName: 'editor'
                              },
                              participant: ALL_AUDIENCES
                            },

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
    });

    it('should have instantiated the PayAction', () => {
      const payAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PayAction'
      );
      // console.log(require('util').inspect(payAction, { depth: null }));
      assert(payAction);
    });

    it('should handle a PayAction', async () => {
      let payAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PayAction'
      );

      payAction = await librarian.post(
        Object.assign({}, payAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      );

      // console.log(require('util').inspect(payAction, { depth: null }));
      assert.equal(payAction.actionStatus, 'CompletedActionStatus');
    });
  });

  describe('Endorsed PayAction', () => {
    let author, editor, periodical, organization, workflowSpecification, graph;

    beforeEach(async () => {
      [author, editor] = await Promise.all(
        ['author', 'editor'].map(name => {
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
                      '@type': 'PayAction',
                      actionStatus: 'ActiveActionStatus',
                      name: 'Article processing charge',
                      endorseOn: 'OnEndorsed',
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
                      priceSpecification: {
                        '@type': 'PriceSpecification',
                        price: 0,
                        priceCurrency: 'USD'
                      },
                      potentialAction: {
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
                    },
                    {
                      '@type': 'CreateReleaseAction',
                      actionStatus: 'ActiveActionStatus',
                      agent: {
                        roleName: 'author'
                      },
                      participant: ALL_AUDIENCES,
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
                            {
                              '@id': '_:rejectAction',
                              '@type': 'RejectAction',
                              actionStatus: 'PotentialActionStatus',
                              agent: {
                                roleName: 'editor'
                              },
                              participant: ALL_AUDIENCES
                            },

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
    });

    it('should handle a PayAction with endorsement', async () => {
      let payAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PayAction'
      );

      // Author set a requestedPrice and stage the pay action so that the EndorseAction is activated
      payAction = await librarian.post(
        Object.assign({}, payAction, {
          actionStatus: 'StagedActionStatus',
          requestedPrice: 0,
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      );

      // console.log(require('util').inspect(payAction, { depth: null }));
      assert.equal(payAction.actionStatus, 'StagedActionStatus');

      // Editor endorse it
      let endorseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'EndorseAction'
      );
      endorseAction = await librarian.post(
        Object.assign({}, endorseAction, {
          agent: getId(arrayify(graph.editor)[0]),
          actionStatus: 'CompletedActionStatus'
        }),
        { acl: editor }
      );

      // console.log(require('util').inspect(endorseAction, { depth: null }));
      payAction = endorseAction.result;
      assert.equal(payAction.actionStatus, 'EndorsedActionStatus');

      // Author completes it
      payAction = await librarian.post(
        Object.assign({}, payAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      );

      // console.log(require('util').inspect(payAction, { depth: null }));
      assert.equal(payAction.actionStatus, 'CompletedActionStatus');
    });

    it('should let the author complete a pay action (and shortcut the endorsement) when a paymentToken is provided', async () => {
      let payAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PayAction'
      );

      // We skip the Endorse and immediately complete the payment
      payAction = await librarian.post(
        Object.assign({}, payAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          paymentToken: {
            '@type': 'PaymentToken',
            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
          }
        }),
        { acl: author }
      );

      // console.log(require('util').inspect(payAction, { depth: null }));
      assert.equal(payAction.actionStatus, 'CompletedActionStatus');
      assert(!payAction.endorseOn);

      // check that EndorseAction have been auto completed
      let endorseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'EndorseAction'
      );
      endorseAction = await librarian.get(endorseAction, { acl: false });
      // console.log(require('util').inspect(endorseAction, { depth: null }));
      assert.equal(endorseAction.actionStatus, 'CompletedActionStatus');
    });
  });

  after(async () => {
    return librarian.close();
  });
});
