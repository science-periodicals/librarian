import assert from 'assert';
import path from 'path';
import once from 'once';
import { fork } from 'child_process';
import uuid from 'uuid';
import { Broker } from '@scipe/workers';
import ds3Mime from '@scipe/ds3-mime';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src/';

describe('Webify actions: dispatch to worker', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical, graph, proc, broker;
  before(done => {
    broker = new Broker({ log: { name: 'broker', level: 'fatal' } });
    broker.listen(err => {
      if (err) throw err;
      proc = fork(path.resolve(__dirname, 'utils/test-worker.js'), [], {
        cwd: __dirname,
        env: {
          BROKER_FRONTEND_CONNECT_ENDPOINT:
            process.env.BROKER_FRONTEND_CONNECT_ENDPOINT ||
            'tcp://127.0.0.1:3003',
          BROKER_BACKEND_CONNECT_ENDPOINT:
            process.env.BROKER_BACKEND_CONNECT_ENDPOINT ||
            'tcp://127.0.0.1:3004',
          BROKER_XPUB_CONNECT_ENDPOINT:
            process.env.BROKER_XPUB_CONNECT_ENDPOINT || 'tcp://127.0.0.1:3001',
          BROKER_XSUB_CONNECT_ENDPOINT:
            process.env.BROKER_XSUB_CONNECT_ENDPOINT || 'tcp://127.0.0.1:3002',
          HEALTH_CHECK_DELAY: 500,
          N_WORKERS: 1
        }
      });

      librarian = new Librarian({
        skipPayments: true,
        log: { level: 'fatal' }
      });
      registerUser()
        .then(_user => {
          user = _user;

          librarian.post(
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
            { acl: user },
            (err, createOrganizationAction) => {
              if (err) {
                return done(err);
              }
              organization = createOrganizationAction.result;

              librarian.post(
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
                { acl: user },
                (err, createPeriodicalAction) => {
                  if (err) return done(err);
                  periodical = createPeriodicalAction.result;

                  librarian.post(
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
                            potentialAction: [
                              {
                                '@type': 'StartWorkflowStageAction',
                                actionStatus: 'PotentialActionStatus',
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
                                  },
                                  {
                                    '@type': 'Audience',
                                    audienceType: 'producer'
                                  }
                                ],
                                result: [
                                  {
                                    '@type': 'CreateReleaseAction',
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
                                    ],
                                    actionStatus: 'ActiveActionStatus'
                                  }
                                ]
                              }
                            ]
                          }
                        }
                      }
                    },
                    { acl: user, skipPayments: true },
                    (err, createWorkflowSpecificationAction) => {
                      if (err) return done(err);
                      const workflowSpecification =
                        createWorkflowSpecificationAction.result;

                      const defaultCreateGraphAction = arrayify(
                        workflowSpecification.potentialAction
                      ).find(action => action['@type'] === 'CreateGraphAction');

                      librarian.post(
                        Object.assign({}, defaultCreateGraphAction, {
                          actionStatus: 'CompletedActionStatus',
                          agent: user['@id'],
                          result: {
                            '@type': 'Graph',
                            author: {
                              roleName: 'author',
                              author: user['@id']
                            },
                            mainEntity: '_:article',
                            '@graph': [
                              {
                                '@id': '_:article',
                                '@type': 'ScholarlyArticle',
                                author: {
                                  '@id': 'role:roleId',
                                  '@type': 'ContributorRole',
                                  roleName: 'author',
                                  author: 'user:userId'
                                },
                                encoding: {
                                  '@type': 'DocumentObject',
                                  fileFormat: ds3Mime,
                                  contentUrl: 'https://example.com'
                                }
                              }
                            ]
                          }
                        }),
                        { acl: user, skipPayments: true },
                        (err, createGraphAction) => {
                          if (err) return done(err);
                          graph = createGraphAction.result;
                          done();
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        })
        .catch(done);
    });
  });

  it('should dispatch a DocumentProcessingAction to the worker, add params with an unroledIdToRoleIdMap prop', done => {
    const encoding = graph['@graph'].find(
      node => node['@type'] === 'DocumentObject'
    );

    librarian.post(
      {
        '@type': 'DocumentProcessingAction',
        actionStatus: 'PotentialActionStatus',
        agent: { roleName: 'author', agent: getId(user) },
        object: Object.assign({}, encoding, { isNodeOf: getId(graph) })
      },
      { acl: user },
      (err, webifyAction) => {
        if (err) return done(err);
        assert.equal(webifyAction['@type'], 'DocumentProcessingAction');

        // console.log(require('util').inspect(webifyAction, { depth: null }));

        assert.deepEqual(webifyAction.params, {
          flattenUpdateActionResult: true,
          unroledIdToRoleIdMap: {
            'user:userId': { __mainEntity__: 'role:roleId' }
          }
        });

        done();
      }
    );
  });

  it('should dispatch a DocumentProcessingAction to the worker and wait untill the action is completed (rpc=true)', done => {
    const encoding = graph['@graph'].find(
      node => node['@type'] === 'DocumentObject'
    );

    librarian.post(
      {
        '@type': 'DocumentProcessingAction',
        actionStatus: 'PotentialActionStatus',
        agent: { roleName: 'author', agent: getId(user) },
        object: Object.assign({}, encoding, { isNodeOf: getId(graph) })
      },
      { acl: user, rpc: true },
      (err, webifyAction) => {
        if (err) return done(err);
        assert.equal(webifyAction.actionStatus, 'CompletedActionStatus');
        done();
      }
    );
  });

  it('should recover from RPC timeout', async () => {
    const encoding = graph['@graph'].find(
      node => node['@type'] === 'DocumentObject'
    );

    await assert.rejects(
      librarian.post(
        {
          '@type': 'DocumentProcessingAction',
          actionStatus: 'PotentialActionStatus',
          agent: { roleName: 'author', agent: getId(user) },
          object: Object.assign({}, encoding, { isNodeOf: getId(graph) }),
          delay: 1000
        },
        { acl: user, rpc: true, rpcTimeout: 200 }
      ),
      {
        code: 500
      }
    );

    const webifyAction = await librarian.post(
      {
        '@type': 'DocumentProcessingAction',
        actionStatus: 'PotentialActionStatus',
        agent: { roleName: 'author', agent: getId(user) },
        object: Object.assign({}, encoding, { isNodeOf: getId(graph) })
      },
      { acl: user, rpc: true }
    );
    assert.equal(webifyAction.actionStatus, 'CompletedActionStatus');
  });

  it('should auto apply the update when called with autoUpdate=true', async () => {
    const encoding = graph['@graph'].find(
      node => node['@type'] === 'DocumentObject'
    );
    const createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    let webifyAction = await librarian.post(
      {
        '@type': 'DocumentProcessingAction',
        actionStatus: 'PotentialActionStatus',
        agent: { roleName: 'author', agent: getId(user) },
        object: Object.assign({}, encoding, { isNodeOf: getId(graph) }),
        instrumentOf: getId(createReleaseAction),
        autoUpdate: true,
        result: {
          '@type': 'UpdateAction',
          actionStatus: 'PotentialActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          object: {
            '@graph': [
              {
                '@type': 'Video'
              }
            ]
          },
          targetCollection: getId(graph)
        }
      },
      { acl: user, rpc: true }
    );

    assert.equal(webifyAction.actionStatus, 'CompletedActionStatus');

    // Note the test worker doesnt do anything (so the completed webify action
    // was not stored in CouchDB) here so we need to manually complete the
    // webifyAction to test the side effect of the `CompletedActionStatus`
    webifyAction = await librarian.post(webifyAction, { acl: user });

    // check that update action was completed and stored in its own doc
    assert.equal(webifyAction.result.actionStatus, 'CompletedActionStatus');
    assert(webifyAction.result._id);
  });

  it('should work with cancelation', done => {
    done = once(done);

    const encoding = graph['@graph'].find(
      node => node['@type'] === 'DocumentObject'
    );

    const actionId = createId('action', null, graph)['@id'];

    librarian.post(
      {
        '@id': actionId,
        '@type': 'DocumentProcessingAction',
        actionStatus: 'PotentialActionStatus',
        agent: { roleName: 'author', agent: getId(user) },
        object: Object.assign({}, encoding, { isNodeOf: getId(graph) }),
        delay: 10000
      },
      { acl: user, rpc: true, rpcTimeout: 20000, strict: false },
      (err, webifyAction) => {
        clearTimeout(timeoutId);
        if (err) {
          return done(err);
        }
        assert.equal(webifyAction.actionStatus, 'CanceledActionStatus');
        done();
      }
    );

    var timeoutId = setTimeout(() => {
      librarian.post(
        {
          '@type': 'CancelAction',
          agent: { roleName: 'author', agent: getId(user) },
          actionStatus: 'CompletedActionStatus',
          object: actionId
        },
        { acl: user },
        (err, action) => {
          if (err) {
            return done(err);
          }
        }
      );
    }, 2000);
  });

  after(() => {
    broker.close();
    proc.kill();
  });
});
