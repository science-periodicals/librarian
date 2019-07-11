import assert from 'assert';
import { getId, unprefix, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  ASSET_LOGO,
  CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_DARK
} from '../src/';

describe('get', function() {
  this.timeout(40000);

  let librarian,
    user,
    organization,
    periodical,
    workflowSpecification,
    graph,
    createPeriodicalAction,
    createWorkflowSpecificationAction,
    createGraphAction,
    createReleaseAction,
    declareAction,
    tagAction;

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

    createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            name: 'editor in chief',
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
              permissionType: 'AdminPermission',
              grantee: [user['@id'], ...ALL_AUDIENCES]
            }
          ],
          logo: {
            '@id': `node:${uuid.v4()}`,
            '@type': 'Image',
            name: ASSET_LOGO,
            encoding: {
              '@id': `node:${uuid.v4()}`,
              '@type': 'ImageObject',
              thumbnail: {
                '@id': `node:${uuid.v4()}`,
                '@type': 'ImageObject'
              }
            }
          },
          style: {
            '@id': `node:${uuid.v4()}`,
            '@type': 'CssVariable',
            name: CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_DARK,
            value: 'url(/encoding/:encodingId)',
            encoding: {
              '@id': `node:${uuid.v4()}`,
              '@type': 'ImageObject',
              thumbnail: {
                '@id': `node:${uuid.v4()}`,
                '@type': 'ImageObject'
              }
            }
          }
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;

    createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
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

              potentialAction: {
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@type': 'CreateReleaseAction',
                    agent: { '@type': 'Role', roleName: 'author' },
                    participant: ALL_AUDIENCES,
                    result: {
                      '@type': 'Graph',
                      potentialAction: {
                        '@type': 'ReviewAction',
                        agent: { roleName: 'reviewer' },
                        participant: ALL_AUDIENCES
                      }
                    }
                  },
                  {
                    '@type': 'DeclareAction',
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
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    createGraphAction = await librarian.post(
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
              '@type': 'Image',
              encoding: {
                '@type': 'ImageObject',
                contentChecksum: {
                  '@type': 'Checksum',
                  checksumValue: 'shavalue'
                }
              }
            }
          ]
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    // add a TagAction
    tagAction = await librarian.post(
      {
        '@type': 'TagAction',
        actionStatus: 'CompletedActionStatus',
        object: graph['@id'],
        agent: getId(arrayify(graph.author)[0]),
        participant: {
          '@type': 'Audience',
          audienceType: 'author'
        },
        result: {
          '@type': 'Tag',
          name: 'my tag'
        }
      },
      { acl: user }
    );

    // we create a release
    // first we need to complete the DeclareAction
    declareAction = graph.potentialAction.find(
      action => action['@type'] === 'DeclareAction'
    );

    declareAction = await librarian.post(
      Object.assign({}, declareAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: user }
    );

    // create the release
    createReleaseAction = await librarian.post(
      Object.assign(
        {},
        graph.potentialAction.find(
          action => action['@type'] === 'CreateReleaseAction'
        ),
        {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }
      ),
      { acl: user }
    );
  });

  it('should get a periodical role', done => {
    const editorRole = arrayify(periodical.editor)[0];
    librarian.get(getId(editorRole), { acl: user }, (err, role, parentDoc) => {
      if (err) return done(err);
      // console.log(require('util').inspect(role, { depth: null }));
      assert.equal(parentDoc['@type'], 'Periodical');
      assert.equal(role['@id'], getId(editorRole));
      done();
    });
  });

  it('should get a periodical logo', done => {
    const logo = createPeriodicalAction.result.logo;
    librarian.get(logo, { acl: user }, (err, logo) => {
      if (err) return done(err);
      assert.equal(logo['@type'], 'Image');
      done();
    });
  });

  it('should get a periodical logo thumbnail', done => {
    const thumbnail = createPeriodicalAction.result.logo.encoding.thumbnail;
    librarian.get(thumbnail, { acl: user }, (err, thumbnail) => {
      if (err) return done(err);
      assert.equal(thumbnail['@type'], 'ImageObject');
      done();
    });
  });

  it('should get a periodical style', done => {
    const style = createPeriodicalAction.result.style;
    librarian.get(style, { acl: user }, (err, style) => {
      if (err) return done(err);
      assert.equal(style['@type'], 'CssVariable');
      done();
    });
  });

  it('should get a periodical style encoding', done => {
    const encoding = createPeriodicalAction.result.style.encoding;
    librarian.get(encoding, { acl: user }, (err, encoding) => {
      if (err) return done(err);
      assert.equal(encoding['@type'], 'ImageObject');
      done();
    });
  });

  it('should get a periodical style encoding thumbnail', done => {
    const thumbnail = createPeriodicalAction.result.style.encoding.thumbnail;
    librarian.get(thumbnail, { acl: user }, (err, thumbnail) => {
      if (err) return done(err);
      assert.equal(thumbnail['@type'], 'ImageObject');
      done();
    });
  });

  it('should get the workflow specification', done => {
    librarian.get(workflowSpecification['@id'], { acl: user }, (err, doc) => {
      if (err) return done(err);
      assert.equal(doc['@type'], 'WorkflowSpecification');
      done();
    });
  });

  it('should get a graph with nodes and potentialAction embedded', done => {
    const graph = createGraphAction.result;
    librarian.get(
      graph['@id'],
      { acl: user, potentialActions: true },
      (err, doc) => {
        if (err) return done(err);
        assert.equal(doc['@type'], 'Graph');
        assert(doc['@graph'].length);
        assert(
          arrayify(doc.potentialAction).some(
            action => action['@type'] === 'DeclareAction'
          )
        );
        done();
      }
    );
  });

  it('should get a graph with only specific type of potentialAction embedded', done => {
    const graph = createGraphAction.result;
    librarian.get(
      graph['@id'],
      {
        acl: user,
        potentialActions: { '@type': 'DeclareAction' }
      },
      (err, doc) => {
        if (err) return done(err);
        assert.equal(doc.potentialAction.length, 1);
        assert.equal(doc.potentialAction[0]['@type'], 'DeclareAction');
        done();
      }
    );
  });

  it('should get a graph with nodes and potentialAction embedded irrespective of the version of the Graph mentionned in their object', done => {
    const graph = createGraphAction.result;
    librarian.get(
      graph['@id'],
      { acl: user, potentialActions: 'all' },
      (err, doc) => {
        if (err) return done(err);

        assert.equal(doc['@type'], 'Graph');
        assert(doc['@graph'].length);
        assert(
          arrayify(doc.potentialAction).some(
            action => action['@type'] === 'ReviewAction'
          )
        );
        done();
      }
    );
  });

  it('should get a graph with with the "dasbhoard" potentialActions option', done => {
    const graph = createGraphAction.result;
    librarian.get(
      graph['@id'],
      { acl: user, potentialActions: 'dashboard' },
      (err, doc) => {
        if (err) return done(err);

        assert.equal(doc['@type'], 'Graph');
        assert(doc['@graph'].length);

        assert(
          arrayify(doc.potentialAction).every(
            action =>
              action['@type'] === 'StartWorkflowStageAction' ||
              action['@type'] === 'TagAction'
          ) &&
            arrayify(doc.potentialAction).some(
              action => action['@type'] === 'StartWorkflowStageAction'
            ) &&
            arrayify(doc.potentialAction).some(
              action => action['@type'] === 'TagAction'
            )
        );
        done();
      }
    );
  });

  it('should get user by username', done => {
    librarian.get(unprefix(user['@id']), { acl: user }, (err, doc) => {
      if (err) return done(err);
      assert.equal(doc['@type'], 'Person');
      done();
    });
  });

  it('should get user by userId', done => {
    librarian.get(user['@id'], { acl: user }, (err, doc) => {
      if (err) return done(err);
      assert.equal(doc['@type'], 'Person');
      done();
    });
  });

  it('should get a TagAction by @id', done => {
    librarian.get(tagAction, { acl: user }, (err, doc) => {
      if (err) return done(err);
      assert.equal(doc['@type'], 'TagAction');
      done();
    });
  });

  it('should get a release', done => {
    const release = createReleaseAction.result;
    librarian.get(release['@id'], { acl: user }, (err, doc) => {
      if (err) return done(err);
      assert.equal(doc['@type'], 'Graph');
      done();
    });
  });

  it('should get a node of a release', done => {
    const release = createReleaseAction.result;
    const node = release['@graph'].find(node => node['@type'] === 'Image');
    librarian.get(
      `${node['@id']}?version=${release.version}`,
      { acl: user },
      (err, doc, parentDoc) => {
        if (err) return done(err);
        assert.equal(doc['@type'], 'Image');
        assert.equal(parentDoc['@type'], 'Graph');
        done();
      }
    );
  });

  it('should get a contact point from a user profile', done => {
    librarian.get(
      getId(arrayify(user.contactPoint)[0]),
      { acl: user },
      (err, doc, parentDoc) => {
        if (err) return done(err);
        assert.equal(doc['@type'], 'ContactPoint');
        assert.equal(parentDoc['@type'], 'Person');
        done();
      }
    );
  });

  it('should get a contact point from an organization', done => {
    librarian.get(
      getId(arrayify(organization.contactPoint)[0]),
      { acl: user },
      (err, doc, parentDoc) => {
        if (err) return done(err);
        assert.equal(doc['@type'], 'ContactPoint');
        assert.equal(parentDoc['@type'], 'Organization');
        done();
      }
    );
  });
});
