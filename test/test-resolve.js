import assert from 'assert';
import uuid from 'uuid';
import querystring from 'querystring';
import pick from 'lodash/pick';
import { getId, arrayify, unprefix } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getScopeId,
  getStageActions,
  getObjectId,
  ALL_AUDIENCES
} from '../src/';

describe('resolve', function() {
  this.timeout(40000);

  const librarian = new Librarian({ skipPayments: true });
  let author,
    coAuthor,
    editor,
    producer,
    reviewer,
    periodical,
    organization,
    workflowSpecification,
    graph,
    nodes,
    stage0,
    stage1,
    service;

  before(async () => {
    [author, coAuthor, editor, reviewer, producer] = await Promise.all(
      ['author', 'author', 'editor', 'reviewer', 'producer'].map(name => {
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

    const typesettingOfferId = createId('node')['@id'];

    const createServiceAction = await librarian.post(
      {
        '@type': 'CreateServiceAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(editor),
        object: getId(organization),
        result: {
          '@type': 'Service',
          serviceType: 'typesetting',
          availableChannel: {
            '@type': 'ServiceChannel',
            processingTime: 'P1D'
          },
          offers: {
            '@id': typesettingOfferId,
            '@type': 'Offer',
            priceSpecification: {
              '@type': 'PriceSpecification',
              price: 0,
              priceCurrency: 'USD',
              valueAddedTaxIncluded: false,
              platformFeesIncluded: false
            }
          }
        }
      },
      { acl: editor }
    );

    service = createServiceAction.result;

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
                  audienceType: 'author'
                }
              ]
            }
          ]
        }
      },
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;

    // Note: extra reviews were added to the workflow to check that multiple
    // actions of the same type can be resolved without ambiguity (ambiguity can
    // happen because @id are uuid so librarian need to take extra care so actions
    // can be resovled with the ?instance= in a non ambiguous way)
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
                    question: [
                      {
                        '@type': 'Question',
                        text: 'q1'
                      },
                      {
                        '@type': 'Question',
                        text: 'q2'
                      }
                    ],
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
                    releaseRequirement: 'ProductionReleaseRequirement',
                    requiresCompletionOf: ['_:declareAction'],
                    potentialService: getId(service),
                    result: {
                      '@type': 'Graph',
                      version: 'preminor',
                      potentialAction: [
                        {
                          '@id': '_:reviewAction',
                          '@type': 'ReviewAction',
                          name: 'a',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            roleName: 'reviewer'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          minInstances: 1,
                          maxInstances: 2
                        },
                        {
                          '@type': 'ReviewAction',
                          name: 'b',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            roleName: 'producer'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          minInstances: 1,
                          maxInstances: 1
                        },
                        {
                          '@type': 'ReviewAction',
                          name: 'c',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          minInstances: 1,
                          maxInstances: 1
                        },
                        {
                          '@type': 'ReviewAction',
                          name: 'triage review',
                          actionStatus: 'ActiveActionStatus',
                          agent: {
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          minInstances: 1,
                          maxInstances: 1
                        },
                        {
                          '@id': '_:submissionAssessAction',
                          '@type': 'AssessAction',
                          actionStatus: 'ActiveActionStatus',
                          name: 'pre-screening',
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
                            },
                            {
                              '@type': 'Audience',
                              audienceType: 'producer'
                            }
                          ],
                          potentialResult: [
                            '_:submissionStage',
                            {
                              '@id': '_:rejectAction',
                              '@type': 'RejectAction',
                              actionStatus: 'PotentialActionStatus',
                              agent: {
                                roleName: 'editor'
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
        }
      },
      { acl: editor }
    );

    workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const graphId = createId('graph', uuid.v4())['@id'];

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@id': graphId,
          '@type': 'Graph',
          mainEntity: '_:article',
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            author: author['@id']
          },
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'ScholarlyArticle',
              author: {
                '@id': createId('role', null)['@id'],
                '@type': 'ContributorRole',
                roleName: 'author',
                author: getId(coAuthor)
              },
              encoding: {
                '@type': 'DocumentObject',
                contentChecksum: {
                  '@type': 'Checksum',
                  checksumAlgorithm: 'sha256',
                  checksumValue: 'sha256-value'
                }
              },
              hasPart: {
                '@type': 'Dataset',
                alternateName: 'Dataset 1'
              }
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );

    graph = createGraphAction.result;

    nodes = arrayify(
      createGraphAction &&
        createGraphAction.result &&
        createGraphAction.result['@graph']
    );

    stage0 = graph.potentialAction.find(
      action => action['@type'] === 'StartWorkflowStageAction'
    );

    // we complete the first stage to be able to test `stage`
    let declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );

    let reviewActions = graph.potentialAction.filter(
      action => action['@type'] === 'ReviewAction'
    );

    let createReleaseAction = graph.potentialAction.find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    let assessAction = graph.potentialAction.find(
      action => action['@type'] === 'AssessAction'
    );

    // complete DeclareAction
    for (const question of declareAction.question) {
      const replyAction = await librarian.post(
        {
          '@type': 'ReplyAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          object: question['@id'],
          resultComment: {
            '@type': 'Answer',
            text: 'answer'
          }
        },
        { acl: author }
      );
      declareAction = replyAction.result;
    }

    declareAction = await librarian.post(
      Object.assign({}, declareAction, {
        agent: getId(arrayify(graph.author)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: author }
    );

    // complete create release
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        agent: getId(arrayify(graph.author)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: author }
    );

    // complete reviews
    for (const reviewAction of reviewActions) {
      if (reviewAction.agent.rolename === 'reviewer') {
        await librarian.post(
          Object.assign({}, reviewAction, {
            agent: getId(arrayify(graph.reviewer)[0]),
            actionStatus: 'CompletedActionStatus',
            resultReview: {
              '@type': 'Review',
              reviewBody: 'All good from reviewer',
              reviewRating: {
                '@type': 'Rating',
                bestRating: 5,
                ratingValue: 5,
                worstRating: 1
              }
            }
          }),
          { acl: reviewer }
        );
      } else if (reviewAction.agent.rolename === 'producer') {
        await librarian.post(
          Object.assign({}, reviewAction, {
            agent: getId(arrayify(graph.producer)[0]),
            actionStatus: 'CompletedActionStatus',
            resultReview: {
              '@type': 'Review',
              reviewBody: 'All good from producer',
              reviewRating: {
                '@type': 'Rating',
                bestRating: 5,
                ratingValue: 4,
                worstRating: 1
              }
            }
          }),
          { acl: producer }
        );
      } else if (reviewAction.agent.rolename === 'editor') {
        await librarian.post(
          Object.assign({}, reviewAction, {
            agent: getId(arrayify(graph.editor)[0]),
            actionStatus: 'CompletedActionStatus',
            resultReview: {
              '@type': 'Review',
              reviewBody: 'All good from editor',
              reviewRating: {
                '@type': 'Rating',
                bestRating: 5,
                ratingValue: 3,
                worstRating: 1
              }
            }
          }),
          { acl: editor }
        );
      }
    }

    // make assessment to trigger cycle
    assessAction = await librarian.post(
      Object.assign({}, assessAction, {
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus',
        result: getId(
          assessAction.potentialResult.find(
            result => result['@type'] !== 'RejectAction'
          )
        )
      }),
      { acl: editor }
    );

    stage1 = assessAction.result;
  });

  it('should resolve CheckActions', async () => {
    const checkAction = await librarian.resolve(
      {
        '@id': `?graph=${unprefix(getScopeId(graph))}`,
        '@type': 'CheckAction',
        agent: `${getId(coAuthor)}?graph=${unprefix(
          getScopeId(graph)
        )}&roleName=author&source=mainEntity`,
        object: getScopeId(graph)
      },
      { strict: false }
    );

    assert(getId(checkAction).startsWith('action:'));
    assert(getId(checkAction.agent).startsWith('role:'));
  });

  it('should resolve workflow action ids', async () => {
    const [reviewAction0, reviewAction1] = arrayify(
      graph.potentialAction
    ).filter(action => action['@type'] === 'ReviewAction');

    const templateId = getId(reviewAction0.instanceOf);

    const [resolved0, resolved1] = await Promise.all(
      [
        {
          '@id': `_:${unprefix(templateId)}?graph=${unprefix(
            getScopeId(graph)
          )}&instance=0`,
          '@type': 'ReviewAction'
        },
        {
          '@id': `_:${unprefix(templateId)}?graph=${unprefix(
            getScopeId(graph)
          )}&instance=1`,
          '@type': 'ReviewAction'
        }
      ].map(action => librarian.resolve(action, { strict: false }))
    );

    assert(
      getId(resolved0) !== getId(resolved1) &&
        [resolved0, resolved1].some(
          action => getId(action) === getId(reviewAction0)
        ) &&
        [resolved0, resolved1].some(
          action => getId(action) === getId(reviewAction1)
        )
    );
  });

  it('should resolve object for questions', async () => {
    const declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );

    // console.log(require('util').inspect(declareAction, { depth: null }));

    const resolved = await librarian.resolve(
      {
        '@type': 'ReplyAction',
        object: `_:${unprefix(
          getId(declareAction.instanceOf)
        )}?graph=${unprefix(getScopeId(graph))}&instance=0&question=1`
      },
      { strict: false }
    );

    // console.log(require('util').inspect(resolved, { depth: null }));

    assert(
      arrayify(declareAction.question).some(
        q => getId(q) === getId(resolved.object)
      )
    );
  });

  it('should handle cycles', async () => {
    const declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );

    const templateId = getId(declareAction.instanceOf);

    const [resolvedStage0, resolvedStage1] = await Promise.all(
      [
        {
          '@id': `_:${unprefix(templateId)}?graph=${unprefix(
            getScopeId(graph)
          )}&instance=0&cycle=0`,
          '@type': 'DeclareAction'
        },
        {
          '@id': `_:${unprefix(templateId)}?graph=${unprefix(
            getScopeId(graph)
          )}&instance=0&cycle=1`,
          '@type': 'ReviewAction'
        }
      ].map(action => librarian.resolve(action, { strict: false }))
    );

    assert.equal(getId(resolvedStage0.resultOf), getId(stage0));
    assert.equal(getId(resolvedStage1.resultOf), getId(stage1));
  });

  it('should resolve instrumentOf a BuyAction', async () => {
    const createReleaseAction = graph.potentialAction.find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    //we use the templateId to get the active action
    const templateId = getId(createReleaseAction.instanceOf);
    const resolved = await librarian.resolve(
      {
        '@type': 'BuyAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        instrumentOf: `_:${unprefix(getId(templateId))}?graph=${unprefix(
          getScopeId(graph)
        )}&instance=0`
      },
      { strict: false }
    );

    assert.equal(
      resolved.instrumentOf.split('?')[0],
      getId(createReleaseAction)
    );
  });

  it('should resolve instrumentOf a BuyAction with a cycle', async () => {
    const createReleaseAction = getStageActions(stage1).find(
      result => result['@type'] === 'CreateReleaseAction'
    );

    //we use the templateId to get the active action
    const templateId = getId(createReleaseAction.instanceOf);
    const resolved = await librarian.resolve(
      {
        '@type': 'BuyAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        instrumentOf: `_:${unprefix(getId(templateId))}?graph=${unprefix(
          getScopeId(graph)
        )}&instance=0&cycle=1`
      },
      { strict: false }
    );

    assert.equal(
      resolved.instrumentOf.split('?')[0],
      getId(createReleaseAction)
    );
  });

  it('should resolve isBasedOn of comments and annotations of AssessAction', async () => {
    const assessAction = getStageActions(stage0).find(
      result => result['@type'] === 'AssessAction'
    );

    const reviewAction = getStageActions(stage0)
      .filter(result => result['@type'] === 'ReviewAction')
      .sort((a, b) => a.identifier.localeCompare(b.identifier))[0];

    const reviewActionIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0`;

    const resolved = await librarian.resolve(
      Object.assign({}, assessAction, {
        '@id': `_:${unprefix(getId(assessAction.instanceOf))}?graph=${unprefix(
          getScopeId(graph)
        )}&instance=0&cycle=0`,
        comment: {
          '@type': 'RevisionRequestComment',
          text: 'Hello revision request comment',
          isBasedOn: [reviewActionIdToResolve, reviewActionIdToResolve]
        },
        annotation: {
          '@type': 'Annotation',
          annotationTarget: null,
          annotationBody: {
            '@type': 'RevisionRequestComment',
            text: 'Hello revision request annotation',
            isBasedOn: reviewActionIdToResolve
          }
        }
      }),
      { strict: false }
    );

    assert.deepEqual(resolved.comment, {
      '@type': 'RevisionRequestComment',
      text: 'Hello revision request comment',
      isBasedOn: [getId(reviewAction), getId(reviewAction)]
    });

    assert.deepEqual(resolved.annotation, {
      '@type': 'Annotation',
      annotationTarget: null,
      annotationBody: {
        '@type': 'RevisionRequestComment',
        text: 'Hello revision request annotation',
        isBasedOn: getId(reviewAction)
      }
    });
  });

  it('should resolve encodesCreativeWork', async () => {
    const graphId = getScopeId(graph);
    const dataset = nodes.find(node => node['@type'] === 'Dataset');
    const resolved = await librarian.resolve(
      {
        '@id': createId('action', null, graphId)['@id'],
        '@type': 'UploadAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(author),
        object: {
          '@type': 'DataDownload',
          encodesCreativeWork: `${getId(
            graph.mainEntity
          )}?${querystring.stringify({
            graph: unprefix(graphId),
            partAlternateName: 'Dataset 1'
          })}`
        }
      },
      { strict: false }
    );
    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.equal(getId(resolved.object.encodesCreativeWork), dataset['@id']);
  });

  it('should resolve CommentAction selector on the body of an action', async () => {
    const createReleaseAction = getStageActions(stage1).find(
      result => result['@type'] === 'CreateReleaseAction'
    );

    const createReleaseActionIdToResolve = `_:${unprefix(
      getId(createReleaseAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=1`;

    const commentAction = {
      '@type': 'CommentAction',
      actionStatus: 'ActiveActionStatus',
      object: {
        '@type': 'TargetRole',
        identifier: '1.0:0.0.0',
        object: createReleaseActionIdToResolve,
        hasSelector: {
          '@type': 'NodeSelector',
          graph: getScopeId(graph),
          node: createReleaseActionIdToResolve,
          selectedProperty: 'description'
        }
      },
      resultComment: {
        '@type': 'Comment',
        text: 'hello description'
      }
    };

    const resolved = await librarian.resolve(commentAction, { strict: false });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(resolved.object, {
      '@type': 'TargetRole',
      identifier: '1.0:0.0.0',
      object: getId(createReleaseAction),
      hasSelector: {
        '@type': 'NodeSelector',
        graph: getScopeId(graph),
        node: getId(createReleaseAction),
        selectedProperty: 'description'
      }
    });
  });

  it('should resolve CommentAction selector on an attachment (nested selector case)', async () => {
    const assessAction = getStageActions(stage0).find(
      action => action['@type'] === 'AssessAction'
    );

    const createReleaseAction = getStageActions(stage1).find(
      result => result['@type'] === 'CreateReleaseAction'
    );

    const createReleaseActionIdToResolve = `_:${unprefix(
      getId(createReleaseAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=1`;
    const assessActionIdToResolve = `_:${unprefix(
      getId(assessAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0`;

    const commentAction = {
      '@type': 'CommentAction',
      actionStatus: 'ActiveActionStatus',
      object: {
        '@type': 'TargetRole',
        identifier: '1.0:0.0.0',
        object: createReleaseActionIdToResolve,
        hasSelector: {
          '@type': 'NodeSelector',
          graph: getScopeId(graph),
          node: createReleaseActionIdToResolve,
          selectedProperty: 'instrument',
          selectedItem: assessActionIdToResolve,
          hasSubSelector: {
            '@type': 'NodeSelector',
            graph: getScopeId(graph),
            node: assessActionIdToResolve,
            selectedProperty: 'result'
          }
        }
      },
      resultComment: {
        '@type': 'Comment',
        text: 'hello decision result'
      }
    };

    const resolved = await librarian.resolve(commentAction, { strict: false });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(resolved.object, {
      '@type': 'TargetRole',
      identifier: '1.0:0.0.0',
      object: getId(createReleaseAction),
      hasSelector: {
        '@type': 'NodeSelector',
        graph: getScopeId(graph),
        node: getId(createReleaseAction),
        selectedProperty: 'instrument',
        selectedItem: getId(assessAction),
        hasSubSelector: {
          '@type': 'NodeSelector',
          graph: getScopeId(graph),
          node: getId(assessAction),
          selectedProperty: 'result'
        }
      }
    });
  });

  it('should resolve CommentAction selector on a question', async () => {
    const declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );

    const declareActionIdToResolve = `_:${unprefix(
      getId(declareAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0`;

    const questionIdToResolve = `_:${unprefix(
      getId(declareAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0&question=0`;

    const commentAction = {
      '@type': 'CommentAction',
      actionStatus: 'ActiveActionStatus',
      object: {
        '@type': 'TargetRole',
        identifier: '1.0:0.0.0',
        object: declareActionIdToResolve,
        hasSelector: {
          '@type': 'NodeSelector',
          graph: getObjectId(declareAction),
          node: declareActionIdToResolve,
          selectedProperty: 'question',
          selectedItem: questionIdToResolve
        }
      },
      resultComment: {
        '@type': 'Comment',
        text: 'hello question'
      }
    };

    const resolved = await librarian.resolve(commentAction, { strict: false });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(resolved.object, {
      '@type': 'TargetRole',
      identifier: '1.0:0.0.0',
      object: getId(declareAction),
      hasSelector: {
        '@type': 'NodeSelector',
        graph: getObjectId(declareAction),
        node: getId(declareAction),
        selectedProperty: 'question',
        selectedItem: getId(arrayify(declareAction.question)[0])
      }
    });
  });

  it('should resolve CommentAction selector on a review', async () => {
    // !! we need to be sure to get the action that will get resoved by ?instance=0
    // => we sort by identifier
    const reviewActions = graph.potentialAction
      .filter(action => action['@type'] === 'ReviewAction')
      .sort((a, b) => {
        return a.identifier.localeCompare(b.identifier);
      });

    const reviewAction = reviewActions[0];

    const reviewActionIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0`;

    const reviewIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0&review=0`;

    const commentAction = {
      '@type': 'CommentAction',
      actionStatus: 'ActiveActionStatus',
      object: {
        '@type': 'TargetRole',
        identifier: '1.0:0.0.0',
        object: reviewActionIdToResolve,
        hasSelector: {
          '@type': 'NodeSelector',
          graph: getObjectId(reviewAction),
          node: reviewActionIdToResolve,
          selectedProperty: 'resultReview',
          hasSubSelector: {
            '@type': 'NodeSelector',
            graph: getObjectId(reviewAction),
            node: reviewIdToResolve,
            selectedProperty: 'reviewBody'
          }
        }
      },
      resultComment: {
        '@type': 'Comment',
        text: 'hello review body'
      }
    };

    const resolved = await librarian.resolve(commentAction, { strict: false });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(resolved.object, {
      '@type': 'TargetRole',
      identifier: '1.0:0.0.0',
      object: getId(reviewAction),
      hasSelector: {
        '@type': 'NodeSelector',
        graph: getObjectId(reviewAction),
        node: getId(reviewAction),
        selectedProperty: 'resultReview',
        hasSubSelector: {
          '@type': 'NodeSelector',
          graph: getObjectId(reviewAction),
          node: getId(reviewAction.resultReview),
          selectedProperty: 'reviewBody'
        }
      }
    });
  });

  it('should resolve annotations', async () => {
    const reviewActions = getStageActions(stage1)
      .filter(action => action['@type'] === 'ReviewAction')
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    const reviewAction = reviewActions[0];

    const reviewActionIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=1`;

    const resolved = await librarian.resolve(
      {
        '@id': reviewActionIdToResolve,
        '@type': 'ReviewAction',
        annotation: {
          '@type': 'Annotation',
          annotationTarget: {
            '@type': 'TargetRole',
            annotationTarget: getObjectId(reviewAction),
            hasSelector: {
              '@type': 'NodeSelector',
              graph: getObjectId(reviewAction),
              node: reviewActionIdToResolve
            }
          }
        }
      },
      { strict: false }
    );

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(pick(resolved, ['@id', '@type', 'annotation']), {
      '@id': getId(reviewAction),
      '@type': 'ReviewAction',
      annotation: {
        '@type': 'Annotation',
        annotationTarget: {
          '@type': 'TargetRole',
          annotationTarget: getObjectId(reviewAction),
          hasSelector: {
            '@type': 'NodeSelector',
            graph: getObjectId(reviewAction),
            node: getId(reviewAction)
          }
        }
      }
    });
  });

  it('should resolve cnode in annotation and comments', async () => {
    const reviewActions = getStageActions(stage1)
      .filter(action => action['@type'] === 'ReviewAction')
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    // console.log(reviewActions);

    const reviewAction = reviewActions[0];

    const reviewActionIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=1`;

    const resolved = await librarian.resolve(
      {
        '@id': reviewActionIdToResolve,
        '@type': 'ReviewAction',
        annotation: {
          '@id': `_:annotation@${unprefix(reviewActionIdToResolve)}`,
          '@type': 'Annotation',
          annotationBody: {
            '@id': `_:annotationBody@${unprefix(reviewActionIdToResolve)}`,
            '@type': 'ReviewerComment'
          }
        },
        comment: {
          '@id': `_:commentBody@${unprefix(reviewActionIdToResolve)}`,
          '@type': 'ReviewerComment'
        }
      },
      { strict: false }
    );

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.deepEqual(
      pick(resolved, ['@id', '@type', 'comment', 'annotation']),
      {
        '@id': getId(reviewAction),
        '@type': 'ReviewAction',
        annotation: {
          '@id': `cnode:annotation@${unprefix(getId(reviewAction))}`,
          '@type': 'Annotation',
          annotationBody: {
            '@id': `cnode:annotationBody@${unprefix(getId(reviewAction))}`,
            '@type': 'ReviewerComment'
          }
        },
        comment: {
          '@id': `cnode:commentBody@${unprefix(getId(reviewAction))}`,
          '@type': 'ReviewerComment'
        }
      }
    );
  });

  it('should resolve TypesettingAction comment ifMatch', async () => {
    const encoding = nodes.find(node => node['@type'] === 'DocumentObject');
    const checksum = nodes.find(node => node['@type'] === 'Checksum');

    const typesettingAction = {
      '@type': 'TypesettingAction',
      comment: {
        ifMatch: `${getId(encoding)}?checksum=sha256`
      }
    };

    const resolved = await librarian.resolve(typesettingAction, {
      strict: false
    });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.equal(resolved.comment.ifMatch, checksum.checksumValue);
  });

  it('should resolve inviteAction purpose', async () => {
    const reviewAction = getStageActions(stage0)
      .filter(result => result['@type'] === 'ReviewAction')
      .sort((a, b) => a.identifier.localeCompare(b.identifier))[0];

    const reviewActionIdToResolve = `_:${unprefix(
      getId(reviewAction.instanceOf)
    )}?graph=${unprefix(getScopeId(graph))}&instance=0&cycle=0`;

    const inviteAction = {
      '@type': 'InviteAction',
      purpose: reviewActionIdToResolve
    };

    const resolved = await librarian.resolve(inviteAction, {
      strict: false
    });

    // console.log(require('util').inspect(resolved, { depth: null }));
    assert.equal(resolved.purpose, getId(reviewAction));
  });
});
