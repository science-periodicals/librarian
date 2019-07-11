import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getStageActions } from '../src';

describe('StartWorkflowStageAction (workflow stage instantiation)', function() {
  this.timeout(40000);

  let librarian, author, editor, organization, periodical;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [author, editor] = await Promise.all([registerUser(), registerUser()]);

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
          ],
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: editor
          }
        }
      },
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;
  });

  describe('cycle case', () => {
    let workflowSpecification;

    before(async () => {
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
                  {
                    '@type': 'DigitalDocumentPermission',
                    permissionType: 'AdminPermission',
                    grantee: [
                      { '@type': 'Audience', audienceType: 'author' },
                      { '@type': 'Audience', audienceType: 'editor' }
                    ]
                  }
                ],
                potentialAction: {
                  '@id': '_:submission',
                  name: 'submission stage',
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: {
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
                      }
                    ],
                    result: {
                      '@type': 'Graph',
                      potentialAction: [
                        {
                          '@id': '_:reviewAction',
                          '@type': 'ReviewAction',
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
                          minInstances: 1,
                          maxInstances: 1
                        },

                        {
                          '@id': '_:assessAction',
                          '@type': 'AssessAction',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          requiresCompletionOf: '_:reviewAction',
                          potentialResult: [
                            {
                              '@id': '_:submission'
                            },
                            {
                              '@id': '_:production',
                              '@type': 'StartWorkflowStageAction',
                              participant: ALL_AUDIENCES,
                              name: 'production stage',
                              result: {
                                '@type': 'PublishAction',
                                agent: { roleName: 'editor' },
                                participant: {
                                  '@type': 'Audience',
                                  audienceType: 'editor'
                                }
                              }
                            },
                            {
                              '@id': '_:rejection',
                              '@type': 'RejectAction',
                              name: 'rejection stage'
                            }
                          ],
                          potentialAction: [
                            {
                              '@type': 'InformAction',
                              name: 'submission letter',
                              ifMatch: '_:submission',
                              instrument: {
                                '@type': 'EmailMessage',
                                about: '_:assessAction',
                                messageAttachment: '_:reviewAction'
                              }
                            },
                            {
                              '@type': 'InformAction',
                              name: 'production letter',
                              ifMatch: '_:production',
                              instrument: {
                                '@type': 'EmailMessage',
                                about: '_:assessAction',
                                messageAttachment: '_:reviewAction'
                              }
                            },
                            {
                              '@type': 'InformAction',
                              name: 'rejection letter',
                              ifMatch: '_:rejection',
                              instrument: {
                                '@type': 'EmailMessage',
                                about: '_:assessAction',
                                messageAttachment: '_:reviewAction'
                              }
                            }
                          ]
                        }
                      ]
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
    });

    it('should instantiate a stage taking into account cycles', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, workflowSpecification.potentialAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.editor)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            editor: getId(arrayify(periodical.editor)[0]),
            author: {
              '@type': 'ContributorRole',
              roleName: 'author',
              author: getId(author)
            }
          }
        }),
        { acl: author, skipPayments: true }
      );

      const graph = createGraphAction.result;

      // console.log(
      //   require('util').inspect(graph, {
      //     depth: null
      //   })
      // );

      // test relabeling
      let assessAction = graph.potentialAction.find(
        action => action['@type'] === 'AssessAction'
      );

      const informActions = graph.potentialAction.filter(
        node => node['@type'] === 'InformAction'
      );

      // check that ifMatch was propertly relabed
      assert(
        informActions.every(informAction =>
          assessAction.potentialResult.some(
            potentialResult => getId(potentialResult) === informAction.ifMatch
          )
        )
      );

      // Check that inform action and email messages have proper identifers
      const rejectInformAction = informActions.find(
        informAction => informAction.name === 'rejection letter'
      );
      assert.equal(rejectInformAction.identifier, '0.2.i.2');
      assert.equal(rejectInformAction.instrument.identifier, '0.2.i.2.e');

      // Create a cycle
      // complete CreateReleaseAction
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

      // complete review
      let reviewAction = graph.potentialAction.find(
        action => action['@type'] === 'ReviewAction'
      );

      reviewAction = await librarian.post(
        Object.assign({}, reviewAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
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
        { acl: author }
      );

      assessAction = await librarian.post(
        Object.assign({}, assessAction, {
          agent: getId(arrayify(graph.editor)[0]),
          actionStatus: 'CompletedActionStatus',
          revisionType: 'MinorRevision',
          result: getId(
            assessAction.potentialResult.find(
              result => result.name === 'submission stage'
            )
          )
        }),
        { acl: editor }
      );

      // instrument was properly set
      assert.deepEqual(
        arrayify(assessAction.instrument).sort(),
        [getId(reviewAction), getId(createReleaseAction)].sort()
      );

      const nextStage = assessAction.result;

      // check that releaseType has the expected effect
      const nextCreateReleaseAction = getStageActions(nextStage).find(
        action => action['@type'] === 'CreateReleaseAction'
      );
      assert.equal(nextCreateReleaseAction.result.version, '0.1.0-0');

      const nextAssessAction = getStageActions(nextStage).find(
        action => action['@type'] === 'AssessAction'
      );
      const nextInformActions = arrayify(
        nextAssessAction.potentialAction
      ).filter(action => action['@type'] === 'InformAction');

      // check that ifMatch was propertly relabed
      assert(
        nextInformActions.every(informAction =>
          nextAssessAction.potentialResult.some(
            potentialResult => getId(potentialResult) === informAction.ifMatch
          )
        )
      );
    });
  });

  describe('intermediary stage without revisions (interesting for testing backporting comment and annotation)', () => {
    let workflowSpecification;

    before(async () => {
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
                  {
                    '@type': 'DigitalDocumentPermission',
                    permissionType: 'AdminPermission',
                    grantee: [
                      { '@type': 'Audience', audienceType: 'author' },
                      { '@type': 'Audience', audienceType: 'editor' }
                    ]
                  }
                ],
                potentialAction: {
                  '@id': '_:submission',
                  name: 'submission stage',
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: {
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
                      }
                    ],
                    result: {
                      '@type': 'Graph',
                      potentialAction: [
                        {
                          '@id': '_:assessAction',
                          '@type': 'AssessAction',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          potentialResult: [
                            {
                              '@id': '_:reassess',
                              '@type': 'StartWorkflowStageAction',
                              participant: ALL_AUDIENCES,
                              name: 're-assess stage',
                              result: {
                                '@type': 'AssessAction',
                                agent: {
                                  roleName: 'editor'
                                },
                                participant: {
                                  '@type': 'Audience',
                                  audienceType: 'editor'
                                },
                                potentialResult: [
                                  {
                                    '@id': '_:production',
                                    '@type': 'StartWorkflowStageAction',
                                    participant: ALL_AUDIENCES,
                                    name: 'production stage',
                                    result: {
                                      '@type': 'PublishAction',
                                      agent: { roleName: 'editor' },
                                      participant: {
                                        '@type': 'Audience',
                                        audienceType: 'editor'
                                      }
                                    }
                                  },
                                  {
                                    '@id': '_:rejection',
                                    '@type': 'RejectAction',
                                    name: 'rejection stage'
                                  }
                                ]
                              }
                            },
                            '_:production',
                            '_:rejection'
                          ]
                        }
                      ]
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
    });

    it('should back port comment and annotation by give them new cnode', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, workflowSpecification.potentialAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.editor)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            editor: getId(arrayify(periodical.editor)[0]),
            author: {
              '@type': 'ContributorRole',
              roleName: 'author',
              author: getId(author)
            }
          }
        }),
        { acl: author, skipPayments: true }
      );

      const graph = createGraphAction.result;

      const createReleaseActionTemplate = graph.potentialAction.find(
        action => action['@type'] === 'CreateReleaseAction'
      );
      const createReleaseAction = await librarian.post(
        Object.assign({}, createReleaseActionTemplate, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      );

      // add comment and annotation and trigger next stage
      const assessActionTemplate = graph.potentialAction.find(
        action => action['@type'] === 'AssessAction'
      );

      const assessAction = await librarian.post(
        Object.assign({}, assessActionTemplate, {
          agent: getId(arrayify(periodical.editor)[0]),
          actionStatus: 'CompletedActionStatus',
          comment: {
            '@type': 'RevisionRequestComment',
            text: 'hello'
          },
          annotation: {
            '@type': 'Annotation',
            annotationBody: {
              '@type': 'RevisionRequestComment',
              text: 'world'
            }
          },
          result: getId(
            arrayify(assessActionTemplate.potentialResult).find(
              res => res.name === 're-assess stage'
            )
          )
        }),
        { acl: editor }
      );

      // check that cnode @id were added to comments and annotations
      const comment = arrayify(assessAction.comment)[0];
      const annotation = arrayify(assessAction.annotation)[0];
      const annotationBody = annotation.annotationBody;
      assert(getId(comment).startsWith('cnode:'));
      assert(getId(annotation).startsWith('cnode:'));
      assert(getId(annotation.annotationBody).startsWith('cnode:'));

      const nextStage = assessAction.result;
      const nextAssessAction = arrayify(nextStage.result).find(
        action => action['@type'] === 'AssessAction'
      );

      const backportedComment = arrayify(nextAssessAction.comment)[0];
      const backportedAnnotation = arrayify(nextAssessAction.annotation)[0];
      const backportedAnnotationBody = backportedAnnotation.annotationBody;

      assert(
        getId(backportedComment).startsWith('cnode:') &&
          getId(backportedComment) !== getId(comment)
      );
      assert(
        getId(backportedAnnotation).startsWith('cnode:') &&
          getId(backportedAnnotation) !== getId(annotation)
      );
      assert(
        getId(backportedAnnotationBody).startsWith('cnode:') &&
          getId(backportedAnnotationBody) !== getId(annotationBody)
      );
    });
  });

  describe('multiplex and polyton actions', async () => {
    let graph;
    before(async () => {
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
                  {
                    '@type': 'DigitalDocumentPermission',
                    permissionType: 'AdminPermission',
                    grantee: [
                      { '@type': 'Audience', audienceType: 'author' },
                      { '@type': 'Audience', audienceType: 'editor' }
                    ]
                  }
                ],
                potentialAction: {
                  '@id': '_:submission',
                  name: 'submission stage',
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: {
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
                      }
                    ],
                    result: {
                      '@type': 'Graph',
                      potentialAction: [
                        {
                          '@id': '_:reviewAction',
                          '@type': 'ReviewAction',
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
                          minInstances: 1,
                          maxInstances: 2
                        },

                        {
                          '@id': '_:assessAction',
                          '@type': 'AssessAction',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          requiresCompletionOf: '_:reviewAction',
                          potentialResult: [
                            {
                              '@id': '_:submission'
                            },
                            {
                              '@id': '_:production',
                              '@type': 'StartWorkflowStageAction',
                              participant: ALL_AUDIENCES,
                              name: 'production stage',
                              result: {
                                '@type': 'PublishAction',
                                agent: { roleName: 'editor' },
                                participant: {
                                  '@type': 'Audience',
                                  audienceType: 'editor'
                                }
                              }
                            },
                            {
                              '@id': '_:rejection',
                              '@type': 'RejectAction',
                              name: 'rejection stage'
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        { acl: editor }
      );

      const workflowSpecification = createWorkflowSpecificationAction.result;

      const createGraphAction = await librarian.post(
        Object.assign({}, workflowSpecification.potentialAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.editor)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            editor: getId(arrayify(periodical.editor)[0]),
            author: {
              '@type': 'ContributorRole',
              roleName: 'author',
              author: getId(author)
            }
          }
        }),
        { acl: author, skipPayments: true }
      );

      graph = createGraphAction.result;
    });

    it('should have multiplexed the ReviewAction and `requiresCompletionOf` of AssessAction', async () => {
      const reviewActions = graph.potentialAction.filter(
        action => action['@type'] === 'ReviewAction'
      );

      assert.equal(reviewActions.length, 2);
      assert(
        reviewActions.every(
          reviewAction => typeof reviewAction.instanceIndex === 'number'
        )
      );

      const assessAction = graph.potentialAction.find(
        action => action['@type'] === 'AssessAction'
      );
      assert.deepEqual(
        assessAction.requiresCompletionOf.sort(),
        reviewActions.map(getId).sort()
      );
    });
  });
});
