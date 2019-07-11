import assert from 'assert';
import omit from 'lodash/omit';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src';

describe('checkAcl and checkPublicAvailability', function() {
  this.timeout(40000);
  const librarian = new Librarian({ skipPayments: true });

  describe('public periodical', function() {
    let author, editor, producer, periodical, graph, release;

    before(async () => {
      [author, editor, producer] = await Promise.all(
        ['author', 'editor', 'producer'].map(name => {
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

      const organization = createOrganizationAction.result;

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          agent: {
            roleName: 'author',
            agent: editor['@id']
          },
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
                permissionType: 'WritePermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: editor['@id']
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ReadPermission',
                grantee: [
                  {
                    '@type': 'Audience',
                    audienceType: 'public'
                  },
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'author' },
                  { '@type': 'Audience', audienceType: 'reviewer' },
                  { '@type': 'Audience', audienceType: 'producer' }
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

      const acceptInviteProducerAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(producer),
          object: getId(inviteProducerAction)
        },
        { acl: producer }
      );

      periodical = acceptInviteProducerAction.result.result;

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
                    '@type': 'PublishAction',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
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

      const defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');

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
              author: author['@id']
            },
            mainEntity: '_:dataset',
            '@graph': [
              {
                '@id': '_:dataset',
                '@type': 'Dataset',
                name: 'data'
              }
            ]
          }
        }),
        { acl: author, skipPayments: true }
      );

      graph = createGraphAction.result;

      // Add producer
      const inviteGraphProducerAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            roleName: 'producer',
            recipient: getId(producer)
          },
          object: getId(graph)
        },
        { acl: editor }
      );

      const acceptInviteGraphProducerAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(producer),
          object: getId(inviteGraphProducerAction)
        },
        { acl: producer }
      );

      graph = Object.assign({}, acceptInviteGraphProducerAction.result.result, {
        '@graph': graph['@graph'],
        potentialAction: graph.potentialAction
      });

      let publishAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PublishAction'
      );

      publishAction = await librarian.post(
        Object.assign({}, publishAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0])
        }),
        { acl: editor }
      );

      release = publishAction.result;
      // console.log(require('util').inspect(publishAction, { depth: null }));
    });

    it('should create a check acl function', async () => {
      const check = await librarian.checkAcl({ docs: graph, agent: editor });
      assert.equal(check([graph['@id'], 'AdminPermission']), true);
    });

    it('should assess if the periodical is public', async () => {
      const isPublic = await librarian.checkPublicAvailability(
        periodical['@id']
      );
      assert.equal(isPublic, true);
    });

    it('checkReadAcl should work for public doc without requiring an user', done => {
      librarian.checkReadAcl(omit(periodical, ['potentialAction']), err => {
        assert(!err);
        done();
      });
    });

    it('checkReadAcl should work for node of a public release without requiring an user', done => {
      const node = release['@graph'][0];
      librarian.checkReadAcl(
        `${getId(node)}?version=${release.version}`,
        err => {
          if (err) return done(err);
          assert(!err);
          done();
        }
      );
    });

    it('should assess if the latest release of a Graph is public', async () => {
      const isPublic = await librarian.checkPublicAvailability(release['@id']);
      assert.equal(isPublic, true);
    });
  });

  describe('private periodical', () => {
    let author, editor, producer, periodical, graph, release;

    before(async () => {
      [author, editor, producer] = await Promise.all(
        ['author', 'editor', 'producer'].map(name => {
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

      const organization = createOrganizationAction.result;

      const createPeriodicalAction = await librarian.post(
        {
          '@type': 'CreatePeriodicalAction',
          agent: {
            roleName: 'author',
            agent: editor['@id']
          },
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
                permissionType: 'WritePermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: editor['@id']
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ReadPermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'author' },
                  { '@type': 'Audience', audienceType: 'reviewer' },
                  { '@type': 'Audience', audienceType: 'producer' }
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

      const acceptInviteProducerAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(producer),
          object: getId(inviteProducerAction)
        },
        { acl: producer }
      );

      periodical = acceptInviteProducerAction.result.result;

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
                    '@type': 'PublishAction',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
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

      const defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');

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
              author: author['@id']
            },
            '@graph': [
              {
                '@type': 'Dataset',
                name: 'data'
              }
            ]
          }
        }),
        { acl: author, skipPayments: true }
      );

      graph = createGraphAction.result;

      // Add producer
      const inviteGraphProducerAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            roleName: 'producer',
            recipient: getId(producer)
          },
          object: getId(graph)
        },
        { acl: editor }
      );

      const acceptInviteGraphProducerAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(producer),
          object: getId(inviteGraphProducerAction)
        },
        { acl: producer }
      );

      graph = Object.assign({}, acceptInviteGraphProducerAction.result.result, {
        '@graph': graph['@graph'],
        potentialAction: graph.potentialAction
      });

      let publishAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'PublishAction'
      );

      publishAction = await librarian.post(
        Object.assign({}, publishAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0])
        }),
        { acl: editor }
      );

      release = publishAction.result;
      // console.log(require('util').inspect(publishAction, { depth: null }));
    });

    it('should assess that the periodical is private', done => {
      librarian.checkPublicAvailability(periodical['@id'], (err, isPublic) => {
        assert.equal(isPublic, false);
        done();
      });
    });

    it('checkReadAcl should error with no user for private journals', done => {
      librarian.checkReadAcl(periodical, err => {
        assert.equal(err.code, 403);
        done();
      });
    });

    it('checkReadAcl should succeed with relevant user for private journals', done => {
      librarian.checkReadAcl(periodical, { agent: editor }, err => {
        assert(!err);
        done();
      });
    });

    it('should have relevant info for graphs of private journals', done => {
      librarian.checkPublicAvailability(release, (err, isPublic) => {
        if (err) return done(err);
        assert.equal(isPublic, false);
        done();
      });
    });

    it('checkReadAcl should error with no user for public graph of private journal', done => {
      librarian.checkReadAcl(release, err => {
        assert(err);
        done();
      });
    });

    it('checkReadAcl should succeed with relevant user for public graph of private journals', done => {
      librarian.checkReadAcl(release, { agent: editor }, err => {
        if (err) {
          return done(err);
        }
        assert(!err);
        done();
      });
    });
  });
});
