import assert from 'assert';
import fs from 'fs';
import path from 'path';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

// See also test-update-release-action.js for release updates

describe('Update graph action', function() {
  this.timeout(40000);

  describe('Graph update', function() {
    let librarian, user, organization, periodical, defaultCreateGraphAction;

    before(async () => {
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

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
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
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType: 'public'
                }
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [user['@id']]
              }
            ]
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
                    '@type': 'CreateReleaseAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: { roleName: 'author' },
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

      defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');
    });

    it('should update the graph metadata through an UpdateAction with OverwriteMergeStrategy', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            }
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          mergeStrategy: 'OverwriteMergeStrategy',
          instrumentOf: getId(createReleaseAction),
          ifMatch: graph._rev,
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          object: {
            name: 'my graph'
          },
          targetCollection: graph['@id']
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));
      assert.equal(updateAction.result.name, 'my graph');
    });

    it('should update graph nodes through an UpdateAction with ReconcileMergeStrategy', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            }
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const dataDownloadId = createId('blank')['@id'];

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          instrumentOf: getId(createReleaseAction),
          agent: getId(arrayify(graph.author)[0]),
          mergeStrategy: 'ReconcileMergeStrategy',
          object: {
            mainEntity: '_:dataset',
            '@graph': [
              {
                '@id': '_:dataset',
                '@type': 'Dataset',
                name: 'my dataset',
                distribution: {
                  '@id': dataDownloadId,
                  '@type': 'DataDownload',
                  name: 'data.csv'
                }
              }
            ]
          },
          targetCollection: graph['@id']
        },
        { acl: user }
      );

      // console.log(
      //   require('util').inspect(updateAction.result, { depth: null })
      // );

      const resource = updateAction.result['@graph'].find(
        node => node['@type'] === 'Dataset'
      );
      const encoding = updateAction.result['@graph'].find(
        node => node['@type'] === 'DataDownload'
      );

      assert(getId(encoding).startsWith('node:'));

      assert(getId(resource).startsWith('node:'), 'proper @id has been given');

      assert.equal(getId(resource), getId(updateAction.result.mainEntity));

      assert.equal(
        resource.distribution[0],
        encoding['@id'],
        '@id have been properly remapped'
      );
      assert.equal(
        encoding.encodesCreativeWork,
        resource['@id'],
        'encodesCreativeWork has been generated'
      );
    });

    it('should upgrade blank node to node: for main entity and first resource', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            }
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(arrayify(graph.author)[0]),
          mergeStrategy: 'ReconcileMergeStrategy',
          actionStatus: 'CompletedActionStatus',
          instrumentOf: getId(createReleaseAction),
          object: {
            mainEntity: '_:main',
            '@graph': [
              {
                '@id': '_:main',
                '@type': 'ScholarlyArticle'
              }
            ]
          },
          targetCollection: getId(graph)
        },
        { acl: user, strict: true }
      );

      assert(getId(updateAction.result.mainEntity).startsWith('node:'));
      assert(
        updateAction.result['@graph'].some(
          node => getId(node) === getId(updateAction.result.mainEntity)
        )
      );
    });

    it('should preserve blank node UUID when updating graph nodes through an UpdateAction with ReconcileMergeStrategy', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            mainEntity: '_:article',
            author: {
              roleName: 'author',
              author: getId(user)
            },
            '@graph': [
              {
                '@id': '_:article',
                '@type': 'ScholarlyArticle',
                hasPart: ['_:image']
              },
              {
                '@id': '_:image',
                '@type': 'Image'
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;
      const resource = graph['@graph'].find(
        node => node['@type'] === 'ScholarlyArticle'
      );

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const blankNodeId = createId('blank')['@id'];

      // we put a fake webify action to trigger the upsert mode
      const webifyAction = await librarian.put({
        '@id': createId('action', null, getId(graph))['@id'],
        '@type': 'DocumentProcessingAction'
      });

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          resultOf: getId(webifyAction),
          instrumentOf: getId(createReleaseAction),
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          mergeStrategy: 'ReconcileMergeStrategy',
          object: {
            '@graph': [
              {
                '@id': getId(resource),
                '@type': 'ScholarlyArticle',
                comment: [blankNodeId]
              },
              {
                '@id': blankNodeId,
                '@type': 'Footnote'
              }
            ]
          },
          targetCollection: graph['@id']
        },
        { acl: user }
      );

      const updatedFootnote = updateAction.result['@graph'].find(
        node => node['@type'] === 'Footnote'
      );

      // be sure that blank node UUID are preserved
      assert.equal(getId(updatedFootnote), blankNodeId);
    });

    it('should backport original encoding', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            },
            mainEntity: '_:article',
            '@graph': [
              {
                '@id': '_:article',
                '@type': 'ScholarlyArticle',
                encoding: [
                  {
                    '@id': '_:pdf',
                    '@type': 'DocumentObject',
                    name: 'article.pdf'
                  }
                ]
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const resource = graph['@graph'].find(
        node => node['@type'] === 'ScholarlyArticle'
      );

      const pdfEncoding = graph['@graph'].find(
        node => node['@type'] === 'DocumentObject'
      );

      // the would be created by UploadAction
      const ds3Encoding = Object.assign(createId('node'), {
        '@type': 'DocumentObject',
        name: 'article.ds3.docx',
        encodesCreativeWork: getId(resource),
        isBasedOn: getId(pdfEncoding)
      });

      let resultingUpdateAction = Object.assign(
        createId('action', null, graph),
        {
          '@type': 'UpdateAction',
          instrumentOf: getId(createReleaseAction),
          actionStatus: 'PotentialActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          targetCollection: graph['@id'],
          object: {
            '@graph': [
              {
                '@id': resource['@id'],
                '@type': 'ScholarlyArticle',
                encoding: {
                  '@type': 'DocumentObject',
                  name: 'article.html',
                  isBasedOn: ds3Encoding
                }
              }
            ]
          }
        }
      );

      let rdfaConversionAction = Object.assign(
        createId('action', null, graph),
        {
          '@type': 'DocumentProcessingAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          object: ds3Encoding,
          instrument: graph['@id'],
          result: resultingUpdateAction['@id']
        }
      );

      resultingUpdateAction.resultOf = rdfaConversionAction['@id'];

      [rdfaConversionAction, resultingUpdateAction] = await librarian.put(
        [rdfaConversionAction, resultingUpdateAction],
        {
          acl: false
        }
      );

      resultingUpdateAction = await librarian.post(
        Object.assign({}, resultingUpdateAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: user }
      );

      // console.log(
      //   require('util').inspect(resultingUpdateAction.result, { depth: null })
      // );

      const updatedResource = resultingUpdateAction.result['@graph'].find(
        node => node['@type'] === 'ScholarlyArticle'
      );

      assert.equal(updatedResource.encoding.length, 3);
    });
  });

  describe('Graph node update', function() {
    let librarian, user, organization, periodical, defaultCreateGraphAction;
    before(async () => {
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

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
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
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType: 'public'
                }
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [user['@id']]
              }
            ]
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
                    '@type': 'CreateReleaseAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: { roleName: 'author' },
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

      defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');
    });

    it('should update a graph node with a ReconcileMergeStrategy UpdateAction', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            },
            mainEntity: '_:main',
            '@graph': [
              {
                '@id': '_:main',
                '@type': 'ScholarlyArticle',
                about: ['subjects:flu']
              },
              {
                '@id': 'subjects:flu',
                identifier: 'preserve me'
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;
      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          agent: getId(arrayify(graph.author)[0]),
          instrumentOf: getId(createReleaseAction),
          object: {
            '@graph': [
              {
                '@id': 'subjects:flu',
                name: 'add me',
                identifier: 'preserve me'
              }
            ]
          },
          targetCollection: getId(graph)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));

      assert.deepEqual(
        arrayify(updateAction.result['@graph']).find(
          node => getId(node) === 'subjects:flu'
        ),
        {
          '@id': 'subjects:flu',
          name: 'add me',
          identifier: 'preserve me'
        }
      );
      // check that rest of the graph is still there
      assert(
        arrayify(updateAction.result['@graph']).find(
          node => node['@type'] === 'ScholarlyArticle'
        )
      );
    });

    it('should replace all the @graph node with an OverwriteMergeStrategy UpdateAction', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            },
            mainEntity: '_:main',
            '@graph': [
              {
                '@id': '_:main',
                '@type': 'ScholarlyArticle',
                about: ['subjects:flu']
              },
              {
                '@id': 'subjects:flu',
                identifier: 'flu'
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;
      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          mergeStrategy: 'OverwriteMergeStrategy',
          agent: getId(arrayify(graph.author)[0]),
          instrumentOf: getId(createReleaseAction),
          object: {
            '@graph': [
              {
                '@id': getId(graph.mainEntity),
                '@type': 'ScholarlyArticle',
                name: 'replaced'
              }
            ]
          },
          targetCollection: getId(graph)
        },
        { acl: user }
      );

      // check that node was overwriten but that the rest of the graph is still there
      assert.deepEqual(updateAction.result['@graph'], [
        {
          '@id': getId(graph.mainEntity),
          '@type': 'ScholarlyArticle',
          isNodeOf: getId(graph),
          name: 'replaced'
        }
      ]);
    });
  });

  describe('UploadAction case', () => {
    let librarian, user, organization, periodical, defaultCreateGraphAction;
    before(async () => {
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
        { acl: user, skipPayments: true }
      );

      organization = createOrganizationAction.result;

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
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
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType: 'public'
                }
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [user['@id']]
              }
            ]
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
                    '@type': 'CreateReleaseAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: { roleName: 'author' },
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

      defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');
    });

    it('should update a Graph with an UpdateAction whose object is an UploadAction', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(user)
            },
            mainEntity: '_:article',
            '@graph': [
              {
                '@id': '_:article',
                '@type': 'ScholarlyArticle',
                name: 'article',
                hasPart: {
                  '@type': 'Image',
                  name: 'image'
                }
              }
            ]
          }
        }),
        { acl: user, skipPayments: true }
      );

      const graph = createGraphAction.result;

      // console.log(require('util').inspect(graph, { depth: null }));

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      // upload a PDF to update the Graph
      // The interesting thing here is that the PDF is unstructured => we should replace the other nodes
      const uploadAction = await librarian.upload(
        fs.createReadStream(path.join(__dirname, 'fixtures', 'article.pdf')),
        {
          acl: user,
          fileFormat: 'application/pdf',
          context: getId(createReleaseAction),
          resource: getId(
            graph['@graph'].find(node => node['@type'] === 'ScholarlyArticle')
          ),
          name: 'article.pdf'
        }
      );

      // Update the Graph with the UploadAction
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(user),
          mergeStrategy: 'ReconcileMergeStrategy',
          actionStatus: 'CompletedActionStatus',
          instrumentOf: getId(createReleaseAction),
          object: uploadAction,
          targetCollection: getId(graph)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));

      assert(
        updateAction.result['@graph'].some(
          node => node['@type'] === 'ScholarlyArticle'
        )
      );
      assert(
        !updateAction.result['@graph'].some(node => node['@type'] === 'Image')
      );
    });
  });

  describe('side effect on TypesettingAction', () => {
    let librarian,
      typesetter,
      author,
      editor,
      organization,
      periodical,
      graph,
      service,
      createReleaseAction,
      typesettingAction;

    before(async () => {
      librarian = new Librarian({ skipPayments: true });
      [typesetter, author, editor] = await Promise.all([
        registerUser({
          '@id': `user:${uuid.v4()}`,
          name: 'peter',
          email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
        }),
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
              '@type': 'Offer',
              priceSpecification: {
                '@type': 'PriceSpecification',
                price: 10,
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
          actionStatus: 'CompletedActionStatus',
          agent: getId(editor),
          object: getId(organization),
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            editor: {
              '@type': 'ContributorRole',
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
                grantee: [
                  {
                    '@type': 'Audience',
                    audienceType: 'editor'
                  },
                  {
                    '@type': 'Audience',
                    audienceType: 'producer'
                  },
                  {
                    '@type': 'Audience',
                    audienceType: 'author'
                  }
                ]
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              }
            ]
          }
        },
        { acl: editor }
      );
      periodical = createPeriodicalAction.result;

      // add typesetter as journal producer
      const inviteTypesetterAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            roleName: 'producer',
            recipient: getId(typesetter)
          },
          object: getId(periodical)
        },
        { acl: editor }
      );
      const acceptInviteTypesetterAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(typesetter),
          object: getId(inviteTypesetterAction)
        },
        { acl: typesetter }
      );
      periodical = acceptInviteTypesetterAction.result.result;

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
              agent: { '@type': 'Role', roleName: 'author' },
              result: {
                '@type': 'Graph',
                hasDigitalDocumentPermission: {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'AdminPermission',
                  grantee: ALL_AUDIENCES
                },
                potentialAction: [
                  {
                    '@type': 'StartWorkflowStageAction',
                    participant: ALL_AUDIENCES,
                    result: [
                      {
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
                        potentialService: getId(service),
                        result: {
                          '@type': 'Graph',
                          version: 'preminor',
                          potentialAction: {
                            '@type': 'PublishAction',
                            agent: {
                              '@type': 'ContributorRole',
                              roleName: 'editor'
                            },
                            participant: {
                              '@type': 'Audience',
                              audienceType: 'editor'
                            }
                          }
                        }
                      }
                    ]
                  }
                ]
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

      const graphId = createId('graph', uuid.v4())['@id'];

      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.producer)[0]),
          result: {
            '@id': graphId,
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(author)
            },
            producer: getId(arrayify(periodical.producer)[0]),
            mainEntity: '_:main',
            '@graph': [
              {
                '@id': '_:main',
                '@type': 'ScholarlyArticle',
                encoding: {
                  '@type': 'DocumentObject',
                  fileFormat: 'application/pdf',
                  name: 'file1.pdf',
                  contentChecksum: {
                    '@type': 'Checksum',
                    checksumAlgorithm: 'sha256',
                    checksumValue: 'value1'
                  }
                }
              }
            ]
          }
        }),
        { acl: author, skipPayments: true }
      );
      // console.log(require('util').inspect(createGraphAction, { depth: null }));
      graph = createGraphAction.result;

      // author buys a TypesettingAction
      createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );
      service = await librarian.get(
        arrayify(createReleaseAction.potentialService)[0],
        { acl: author }
      );
      const offer = service.offers;
      const buyActionTemplate = arrayify(offer.potentialAction)[0];

      const buyAction = await librarian.post(
        Object.assign({}, buyActionTemplate, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          instrumentOf: getId(createReleaseAction),
          object: getId(service.offers),
          paymentToken: {
            '@type': 'PaymentToken',
            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
          }
        }),
        {
          acl: author
        }
      );

      typesettingAction = buyAction.result.orderedItem;
    });

    it("should update a typesetting action when updating it's object (encoding)", async () => {
      const resource = graph['@graph'].find(
        node => node['@type'] === 'ScholarlyArticle'
      );
      const encoding = graph['@graph'].find(
        node => node['@type'] === 'DocumentObject'
      );

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(author),
          actionStatus: 'CompletedActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          instrumentOf: getId(createReleaseAction),
          object: {
            '@graph': [
              Object.assign({}, resource, {
                encoding: {
                  '@type': 'DocumentObject',
                  fileFormat: 'application/pdf',
                  name: 'file2.pdf',
                  contentChecksum: {
                    '@type': 'Checksum',
                    checksumAlgorithm: 'sha256',
                    checksumValue: 'value2'
                  }
                }
              })
            ]
          },
          targetCollection: getId(graph)
        },
        { acl: author }
      );

      const updatedTypesettingAction = await librarian.get(typesettingAction, {
        acl: author
      });

      //console.log(
      //  require('util').inspect(updatedTypesettingAction, { depth: null })
      //);

      assert.equal(updatedTypesettingAction.object.name, 'file2.pdf');
      assert.equal(
        getId(updatedTypesettingAction.object.supersedes),
        getId(encoding)
      );
      assert.equal(
        arrayify(updatedTypesettingAction.object.supersedes.contentChecksum)[0]
          .checksumValue,
        'value1'
      );
    });
  });
});
