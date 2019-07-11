import assert from 'assert';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getAgent, Store } from '../src';

describe('CommentAction', function() {
  this.timeout(40000);

  let librarian,
    editor,
    author,
    producer,
    organization,
    periodical,
    defaultCreateGraphAction;

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
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    }
                  ],
                  potentialAction: {
                    '@type': 'AuthorizeAction',
                    actionStatus: 'PotentialActionStatus',
                    completeOn: 'OnObjectCompletedActionStatus',
                    recipient: {
                      '@type': 'Audience',
                      audienceType: 'producer'
                    }
                  },
                  result: {
                    '@type': 'Graph',
                    potentialAction: [
                      {
                        '@type': 'ReviewAction',
                        actionStatus: 'ActiveActionStatus',
                        completeOn: 'OnEndorsed',
                        agent: {
                          '@type': 'ContributorRole',
                          roleName: 'author'
                        },
                        participant: {
                          '@type': 'Audience',
                          audienceType: 'author'
                        },
                        potentialAction: [
                          {
                            '@type': 'EndorseAction',
                            activateOn: 'OnObjectStagedActionStatus',
                            actionStatus: 'PotentialActionStatus',
                            agent: {
                              '@type': 'ContributorRole',
                              roleName: 'editor'
                            },
                            participant: {
                              '@type': 'Audience',
                              audienceType: 'editor'
                            }
                          },
                          {
                            '@type': 'AuthorizeAction',
                            actionStatus: 'PotentialActionStatus',
                            completeOn: 'OnObjectStagedActionStatus',
                            recipient: {
                              '@type': 'Audience',
                              audienceType: 'editor'
                            }
                          }
                        ]
                      },
                      {
                        '@type': 'AssessAction',
                        actionStatus: 'ActiveActionStatus',
                        agent: {
                          '@type': 'ContributorRole',
                          roleName: 'editor'
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
                        potentialResult: [
                          {
                            '@type': 'RejectAction'
                          },
                          '_:stage'
                        ],
                        potentialAction: {
                          '@type': 'AuthorizeAction',
                          actionStatus: 'PotentialActionStatus',
                          completeOn: 'OnObjectCompletedActionStatus',
                          recipient: {
                            '@type': 'Audience',
                            audienceType: 'author'
                          }
                        }
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

    defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');
  });

  describe('Regular comments (Comment)', () => {
    let graph, parentCommentAction, reviewAction;

    before(async () => {
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

      graph = createGraphAction.result;

      let createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

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

      reviewAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'ReviewAction'
      );

      // stage the review action
      reviewAction = await librarian.post(
        Object.assign({}, reviewAction, {
          actionStatus: 'StagedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          resultReview: {
            '@type': 'Review',
            reviewBody: 'text',
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

      const commentAction = await librarian.post(
        {
          '@type': 'CommentAction',
          agent: getId(arrayify(graph.author)[0]),
          actionStatus: 'PotentialActionStatus',
          completeOn: 'OnObjectCompletedActionStatus',
          object: {
            '@type': 'TargetRole',
            identifier: '1.0:1.0.1',
            object: getId(reviewAction)
          },
          resultComment: {
            '@type': 'Comment',
            text: 'hello'
          },
          participant: {
            '@type': 'Audience',
            audienceType: 'author'
          }
        },
        { acl: author }
      );

      parentCommentAction = commentAction;
    });

    it('should have created a commentAction', async () => {
      // console.log(
      //   require('util').inspect(parentCommentAction, { depth: null })
      // );

      assert(
        parentCommentAction.resultComment['@id'],
        'an @id was set for result comment'
      );

      // check that ReviewAction audience was backported
      assert(
        arrayify(parentCommentAction.participant).some(
          participant =>
            unrole(participant, 'participant').audienceType === 'author'
        )
      );
    });

    it('should activate a potential comment action', async () => {
      parentCommentAction = await librarian.post(
        Object.assign({}, parentCommentAction, {
          actionStatus: 'ActiveActionStatus'
        }),
        { acl: author }
      );

      // console.log(
      //   require('util').inspect(parentCommentAction, { depth: null })
      // );
      assert.equal(parentCommentAction.actionStatus, 'ActiveActionStatus');
    });

    it('should handle a child comment action', async () => {
      const commentAction = await librarian.post(
        {
          '@type': 'CommentAction',
          agent: getId(arrayify(graph.author)[0]),
          actionStatus: 'ActiveActionStatus',
          completeOn: 'OnObjectCompletedActionStatus',
          object: getId(reviewAction),
          resultComment: {
            '@type': 'Comment',
            parentItem: getId(parentCommentAction.resultComment),
            text: 'world'
          }
        },
        { acl: author }
      );

      // console.log(require('util').inspect(commentAction, { depth: null }));
      assert(
        commentAction.resultComment.parentItem,
        'the parentItem was stored'
      );
    });
  });

  describe('Endorser comments (EndoserComment) and trigger', () => {
    let graph, commentAction, reviewAction;

    before(async () => {
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

      graph = createGraphAction.result;

      let createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

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

      reviewAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'ReviewAction'
      );

      // stage the review action
      reviewAction = await librarian.post(
        Object.assign({}, reviewAction, {
          actionStatus: 'StagedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          resultReview: {
            '@type': 'Review',
            reviewBody: 'text',
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

      commentAction = await librarian.post(
        {
          '@type': 'CommentAction',
          agent: getId(arrayify(graph.editor)[0]),
          actionStatus: 'ActiveActionStatus',
          completeOn: 'OnObjectCompletedActionStatus',
          object: {
            '@type': 'TargetRole',
            identifier: '1.0:1.0.1',
            object: getId(reviewAction)
          },
          resultComment: {
            '@type': 'EndorserComment',
            text: 'hello'
          }
        },
        { acl: editor }
      );

      // console.log(require('util').inspect(commentAction, { depth: null }));
    });

    it('should have created a commentAction', async () => {
      assert(
        commentAction.resultComment['@id'],
        'an @id was set for result comment'
      );
      assert.equal(commentAction.actionStatus, 'ActiveActionStatus');
    });

    it('should complete the commentAction when the trigger is triggered', async () => {
      let endorseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'EndorseAction'
      );

      endorseAction = await librarian.post(
        Object.assign({}, endorseAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0])
        }),
        { acl: editor }
      );

      commentAction = await librarian.get(getId(commentAction), {
        acl: editor
      });
      assert.equal(commentAction.actionStatus, 'CompletedActionStatus');
    });
  });

  describe('comment audience', () => {
    let graph;
    before(async () => {
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

      graph = createGraphAction.result;

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
    });

    it('should not update the audience of a comment action when the audience of the object changes', async () => {
      // Stage the create release action
      let createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      createReleaseAction = await librarian.post(
        Object.assign({}, createReleaseAction, {
          actionStatus: 'StagedActionStatus',
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

      assert.deepEqual(getAudienceTypes(createReleaseAction).sort(), [
        'author',
        'editor'
      ]);

      // Make a comment when the CRA doesn't have producer has part of the audience
      // => comment audience is just author and editor

      const commentAction = await librarian.post(
        {
          '@type': 'CommentAction',
          agent: getId(arrayify(graph.author)[0]),
          actionStatus: 'ActiveActionStatus',
          completeOn: 'OnObjectCompletedActionStatus',
          object: getId(createReleaseAction),
          resultComment: {
            '@type': 'Comment',
            text: 'hello'
          }
        },
        { acl: author }
      );

      assert.deepEqual(getAudienceTypes(commentAction).sort(), [
        'author',
        'editor'
      ]);

      const store = new Store();

      // Complete the CRA to trigger change of audiences
      createReleaseAction = await librarian.post(
        Object.assign({}, createReleaseAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author, store }
      );

      assert.deepEqual(getAudienceTypes(createReleaseAction).sort(), [
        'author',
        'editor',
        'producer'
      ]);

      const triggeredCommentAction = store.get(getId(commentAction));
      assert.equal(
        triggeredCommentAction.actionStatus,
        'CompletedActionStatus'
      );
      // check that comment action audience was not impacted
      assert.deepEqual(getAudienceTypes(triggeredCommentAction).sort(), [
        'author',
        'editor'
      ]);
    });
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
