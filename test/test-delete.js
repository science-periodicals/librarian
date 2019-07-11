import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src';

describe('delete', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();
  });

  describe('delete Organization', () => {
    let organization;
    before(async () => {
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

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          agent: user['@id'],
          actionStatus: 'CompletedActionStatus',
          object: organization['@id'],
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            name: 'my journal',
            author: {
              roleName: 'author',
              author: user
            },
            editor: {
              roleName: 'editor',
              editor: user
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
        { acl: user }
      );
    });

    it('should delete an Organization and associated resources', async () => {
      const itemList = await librarian.delete(getId(organization), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );
      // console.log(require('util').inspect(deletedDocs, { depth: null }));

      assert(
        deletedDocs.some(doc => doc._deleted && doc['@type'] === 'Organization')
      );
      assert(
        deletedDocs.some(doc => doc._deleted && doc['@type'] === 'Periodical')
      );
    });
  });

  describe('delete Periodical', () => {
    let organization, periodical;
    before(async () => {
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

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          agent: user['@id'],
          actionStatus: 'CompletedActionStatus',
          object: organization['@id'],
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            name: 'my journal',
            author: {
              roleName: 'author',
              author: user
            },
            editor: {
              roleName: 'editor',
              editor: user
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
        { acl: user }
      );
      periodical = createPeriodicalAction.result;
    });

    it('should delete a Periodical and associated resources', async () => {
      const itemList = await librarian.delete(getId(periodical), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );

      // console.log(require('util').inspect(deletedDocs, { depth: null }));

      assert(
        deletedDocs.some(doc => doc._deleted && doc['@type'] === 'Periodical')
      );
      assert(
        deletedDocs.some(
          doc => doc._deleted && doc['@type'] === 'CreatePeriodicalAction'
        )
      );
    });
  });

  describe('delete Graph and Actions', () => {
    let organization,
      periodical,
      graph,
      tagAction,
      parentCommentAction,
      childCommentAction1,
      childCommentAction2;

    before(async () => {
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

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          agent: user['@id'],
          actionStatus: 'CompletedActionStatus',
          object: organization['@id'],
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            name: 'my journal',
            author: {
              roleName: 'author',
              author: user
            },
            editor: {
              roleName: 'editor',
              editor: user
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
        { acl: user }
      );
      periodical = createPeriodicalAction.result;

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
                  result: {
                    '@type': 'ReviewAction',
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
                    ]
                  }
                }
              }
            }
          }
        },
        { acl: user }
      );

      const workflowSpecification = createWorkflowSpecificationAction.result;

      const defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');

      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: user['@id']
            },
            '@graph': [
              {
                '@type': 'ScholarlyArticle',
                encoding: {
                  '@type': 'DocumentObject'
                }
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      graph = createGraphAction.result;

      let reviewAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'ReviewAction'
      );

      commentAction = await librarian.post(
        Object.assign({}, reviewAction, {
          actionStatus: 'StagedActionStatus',
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
        { acl: user }
      );

      // Add TagAction
      tagAction = await librarian.post(
        {
          '@type': 'TagAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          object: graph['@id'],
          result: {
            '@type': 'Tag',
            name: 'my tag'
          }
        },
        { acl: user }
      );

      // Create comments and child comments

      let commentAction = await librarian.post(
        {
          '@type': 'CommentAction',
          actionStatus: 'ActiveActionStatus',
          completeOn: 'OnObjectCompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          object: getId(reviewAction),
          resultComment: {
            '@type': 'Comment',
            text: 'text'
          }
        },
        { acl: user }
      );

      parentCommentAction = commentAction;

      [childCommentAction1, childCommentAction2] = await Promise.all(
        ['text1', 'text2'].map(text =>
          librarian.post(
            {
              '@type': 'CommentAction',
              actionStatus: 'ActiveActionStatus',
              completeOn: 'OnObjectCompletedActionStatus',
              agent: getId(arrayify(graph.author)[0]),
              object: getId(reviewAction),
              resultComment: {
                '@type': 'Comment',
                parentItem: getId(parentCommentAction.resultComment),
                text
              }
            },
            { acl: user }
          )
        )
      );

      graph = createGraphAction.result;
    });

    it('should delete child comment', async () => {
      const itemList = await librarian.delete(getId(childCommentAction2), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );

      // console.log(require('util').inspect(deletedDocs, { depth: null }));

      assert.equal(
        arrayify(deletedDocs).length,
        1,
        'only the child comment was deleted'
      );

      assert.equal(
        getId(deletedDocs[0]),
        getId(childCommentAction2),
        'only the specified child comment was deleted'
      );
    });

    it('should delete comments (and children)', async () => {
      const itemList = await librarian.delete(getId(parentCommentAction), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );

      // console.log(require('util').inspect(deletedDocs, { depth: null }));
      assert(
        deletedDocs.length > 1, // note depending on if previous test was run or not could be 2 or 3
        'parent and child comment were deleted'
      );

      assert(
        deletedDocs.some(
          deleted => getId(deleted) === getId(parentCommentAction)
        ),
        'the parent comment action was deleted'
      );
      assert(
        deletedDocs.some(
          deleted => getId(deleted) === getId(childCommentAction1)
        ),
        'the child comment action was deleted'
      );
    });

    it('should delete a TagAction', async () => {
      const itemList = await librarian.delete(getId(tagAction), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );
      // console.log(require('util').inspect(deletedDocs, { depth: null }));

      assert.equal(arrayify(deletedDocs)[0]['@type'], 'TagAction');
    });

    it('should delete a Graph and associated resources', async () => {
      const itemList = await librarian.delete(getId(periodical), {
        acl: user
      });
      const deletedDocs = itemList.itemListElement.map(
        itemListElement => itemListElement.item
      );
      // console.log(require('util').inspect(deletedDocs, { depth: null }));

      assert(deletedDocs.some(doc => doc._deleted && doc['@type'] === 'Graph'));
    });
  });
});
