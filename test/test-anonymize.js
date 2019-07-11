import assert from 'assert';
import omit from 'lodash/omit';
import { getId, arrayify } from '@scipe/jsonld';
import { Librarian, Acl, Store, getScopeId, createId } from '../src';

describe('anonymize & getBlindingData', function() {
  this.timeout(40000);

  const librarian = new Librarian({ skipPayments: true });
  const now = 1559845259740;

  const encryptionKey = {
    '@type': 'EncryptionKey',
    value: '2cc9d8c36deedfbec32edd461ca70cefe4723c93534beec393dcabb1fa4f3320',
    initializationVector: '53823a09fb3fd009c3838e8686d96d29'
  };

  describe('Graph contributors', () => {
    const graph = {
      '@id': 'graph:graphId',
      '@type': 'Graph',
      encryptionKey,
      editor: {
        '@id': 'role:reditor1',
        '@type': 'ContributorRole',
        roleName: 'editor',
        editor: 'user:editor1',
        startDate: new Date(now).toISOString()
      },
      author: [
        {
          '@id': 'role:rauthor1',
          '@type': 'ContributorRole',
          roleName: 'author',
          startDate: new Date(now).toISOString(),
          author: {
            '@id': 'user:author1',
            '@type': 'Person'
          }
        },
        {
          '@id': 'role:rauthor2',
          '@type': 'ContributorRole',
          roleName: 'author',
          startDate: new Date(now + 1).toISOString(),
          author: {
            '@id': 'user:author2',
            '@type': 'Person',
            name: 'author 2'
          }
        }
      ],
      reviewer: {
        '@id': 'role:rreviewer1',
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        reviewer: 'user:reviewer1',
        startDate: new Date(now).toISOString()
      },
      hasDigitalDocumentPermission: {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: {
          '@type': 'Audience',
          audienceType: 'editor'
        },
        permissionScope: [
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
            audienceType: 'producer'
          },
          {
            '@type': 'Audience',
            audienceType: 'reviewer'
          }
        ]
      },
      mainEntity: 'node:article',
      '@graph': [
        {
          '@id': 'node:article',
          '@type': 'ScholarlyArticle',
          author: ['role:rauthor3', 'role:rauthor1Alias'],
          hasPart: ['node:dataset', 'node:image']
        },
        {
          '@id': 'role:rauthor3',
          '@type': 'ContributorRole',
          roleName: 'author',
          author: 'user:author3',
          roleAffiliation: ['org:org3']
        },
        {
          '@id': 'role:rauthor1Alias', // manuscript author role @id are independant from the Graph role @id
          '@type': 'ContributorRole',
          roleName: 'author',
          author: 'user:author1',
          roleAffiliation: ['org:org1']
        },
        {
          '@id': 'node:dataset',
          '@type': 'Dataset',
          author: 'role:rauthor3'
        },
        {
          '@id': 'node:image',
          '@type': 'Image',
          author: 'role:rauthor3alias'
        },
        {
          '@id': 'role:rauthor3alias',
          '@type': 'ContributorRole',
          roleName: 'author',
          author: 'user:author3',
          roleAffiliation: ['org:org3']
        },
        {
          '@id': 'org:org1',
          '@type': 'Organization',
          name: 'org 1'
        },
        {
          '@id': 'org:org2',
          '@type': 'Organization',
          name: 'org 2'
        },
        {
          '@id': 'org:org3',
          '@type': 'Organization',
          name: 'org 3'
        },
        {
          '@id': 'user:user3',
          '@type': 'Person',
          name: 'Tiffany'
        }
      ]
    };

    it('should anonymize a graph from a reviewer perspective (cannot see identity but himslef)', async () => {
      const anonymized = await librarian.anonymize(graph, {
        viewer: 'user:reviewer1'
      });
      // console.log(require('util').inspect(anonymized, { depth: null }));

      // graph author has been anonymized
      assert.deepEqual(
        anonymized.author.find(node => getId(node) === 'role:rauthor1'),
        {
          '@id': 'role:rauthor1',
          '@type': 'ContributorRole',
          roleName: 'author',
          startDate: '2019-06-06T18:20:59.740Z',
          author: {
            '@id':
              'anon:24d6e38b988d2e02c03b9cd2ffd6fc34ac0bdd44eec26f81aa300ea7f99ca824',
            '@type': 'Person'
          }
        }
      );

      // main entity author has been anonymized
      assert.deepEqual(
        anonymized['@graph'].find(node => getId(node) === 'role:rauthor3'),
        {
          '@id': 'role:rauthor3',
          '@type': 'ContributorRole',
          author: [
            'anon:c260b759a768680f744595f4a0973d9cd7ec3cff20c6e94458564fc5cc7a2e45'
          ],
          roleName: 'author'
        }
      );

      // reviewer can see himself and has been sameAs
      assert.deepEqual(anonymized.reviewer, {
        '@id': 'role:rreviewer1',
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        reviewer: {
          '@id': 'user:reviewer1',
          sameAs: [
            'anon:16b60bbfd7df5cd902977e5d8be128b39adbdc71ec8d3ac65806accbf5aaf85c'
          ]
        },
        startDate: '2019-06-06T18:20:59.740Z'
      });

      // anonymized graph has no org nodes (it has been purged)
      assert(
        !anonymized['@graph'].some(node => node['@type'] === 'Organization')
      );

      const acl = new Acl(anonymized);
      const blindingData = acl.getBlindingData('user:reviewer1');
      // console.log(require('util').inspect(blindingData, { depth: null }));

      // graph contribs
      assert.equal(blindingData.getAnonymousIdentifier('role:rauthor1'), '1');
      assert.equal(blindingData.getAnonymousIdentifier('role:rauthor2'), '2');
      assert.equal(blindingData.getAnonymousIdentifier('role:reditor1'), '1');
      assert.equal(blindingData.getAnonymousIdentifier('role:rreviewer1'), '1');

      // main entity
      assert.equal(
        blindingData.getAnonymousIdentifier('role:rauthor3', {
          maxCharacters: null
        }),
        'rauthor3'
      );

      assert.equal(
        blindingData.getAnonymousIdentifier('role:rauthor3', {
          maxCharacters: 3
        }),
        'rau'
      );
    });

    it('should anonymize a graph from an editor perspective (can see all identity => no need for sameAs)', async () => {
      const anonymized = await librarian.anonymize(graph, {
        viewer: 'user:editor1'
      });
      // console.log(require('util').inspect(anonymized, { depth: null }));

      assert.deepEqual(anonymized.reviewer, {
        '@id': 'role:rreviewer1',
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        reviewer: 'user:reviewer1',
        startDate: '2019-06-06T18:20:59.740Z'
      });

      const acl = new Acl(anonymized);
      const blindingData = acl.getBlindingData('user:editor1');
      assert.equal(blindingData.getAnonymousIdentifier('role:rauthor1'), '1');
      assert.equal(
        blindingData.getAnonymousIdentifier('role:rauthor3', {
          maxCharacters: null
        }),
        'rauthor3'
      );
    });
  });

  describe('Release contributors (different case as contributor can be on the live graph but _not_ on the release)', () => {
    it('should work when a contributor is only on the live graph but not on the release', async () => {
      const release = {
        '@id': 'graph:graphId?version=1.0.0',
        '@type': 'Graph',
        version: '1.0.0',
        encryptionKey,
        editor: {
          '@id': 'role:editor1',
          '@type': 'ContributorRole',
          roleName: 'editor',
          editor: 'user:editor'
        },
        author: [
          {
            '@id': 'role:author1',
            '@type': 'ContributorRole',
            roleName: 'author',
            author: {
              '@id': 'user:adam',
              '@type': 'Person'
            }
          }
        ],
        hasDigitalDocumentPermission: {
          '@type': 'DigitalDocumentPermission',
          permissionType: 'ViewIdentityPermission',
          grantee: [
            {
              '@type': 'Audience',
              audienceType: 'editor'
            },
            {
              '@type': 'Audience',
              audienceType: 'reviewer'
            }
          ],
          permissionScope: [
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
              audienceType: 'producer'
            },
            {
              '@type': 'Audience',
              audienceType: 'reviewer'
            }
          ]
        }
      };

      // Here the reviewer is added _after_ the release
      const graph = omit(
        Object.assign(omit(release, ['version']), {
          '@id': getScopeId(getId(release)),
          reviewer: {
            '@id': 'role:reviewer1',
            '@type': 'ContributorRole',
            roleName: 'reviewer',
            reviewer: 'user:reviewer'
          }
        })
      );

      const viewer = 'role:reviewer1';
      const anonymizedGraph = await librarian.anonymize(release, {
        viewer,
        store: new Store([release, graph])
      });

      // reviewer can view author identity because the `getVisibleRoleNames` operates based on the live graph and not the release
      assert.equal(getId(anonymizedGraph.author[0].author), 'user:adam');
    });
  });

  describe('InviteAction', () => {
    const graph = {
      '@id': 'graph:graphId',
      '@type': 'Graph',
      encryptionKey,
      editor: {
        '@id': 'role:editor1',
        '@type': 'ContributorRole',
        roleName: 'editor',
        editor: 'user:editor1'
      },
      author: [
        {
          '@id': 'role:author1',
          '@type': 'ContributorRole',
          roleName: 'author',
          author: {
            '@id': 'user:author1',
            '@type': 'Person'
          }
        }
      ],
      hasDigitalDocumentPermission: {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: {
          '@type': 'Audience',
          audienceType: 'editor'
        },
        // Note editor cannot view identity of producer so we can test addition of sameAs
        permissionScope: [
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
        ]
      }
    };

    const store = new Store(graph);

    const inviteAction = {
      '@id': 'action:inviteActionId',
      '@type': 'InviteAction',
      agent: 'role:editor1',
      object: 'graph:graphId',
      recipient: {
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        recipient: {
          '@type': 'Person',
          email: 'mailto:reviewer@example.com'
        }
      }
    };

    it('should anonymize an InviteAction from the perspective of an editor (can view identity)', async () => {
      const expectedRecipient = {
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        recipient: {
          '@type': 'Person',
          email: 'mailto:reviewer@example.com',
          sameAs: [
            'anon:e817abb9b5c81760194a4e29cadfc061448334ae3b128199dc7cf17986a26e2d'
          ]
        }
      };

      const anonymizedInviteAction = await librarian.anonymize(inviteAction, {
        viewer: 'user:editor1',
        store
      });

      // console.log(
      //   require('util').inspect(anonymizedInviteAction, { depth: null })
      // );

      assert.deepEqual(anonymizedInviteAction.recipient, expectedRecipient);
    });

    it('should anonymize an InviteAction from the perspective of an author (cannot view identity)', async () => {
      const expectedRecipient = {
        '@type': 'ContributorRole',
        roleName: 'reviewer',
        recipient: {
          '@id': `anon:e817abb9b5c81760194a4e29cadfc061448334ae3b128199dc7cf17986a26e2d`,
          '@type': 'Person'
        }
      };

      const anonymizedInviteAction = await librarian.anonymize(inviteAction, {
        viewer: 'user:author1',
        store
      });

      // console.log(
      //   require('util').inspect(anonymizedInviteAction, { depth: null })
      // );
      assert.deepEqual(anonymizedInviteAction.recipient, expectedRecipient);
    });
  });

  describe('Graph actions', () => {
    const graph = Object.assign(createId('graph', 'graphId'), {
      '@id': 'graph:graphId',
      '@type': 'Graph',
      encryptionKey,
      editor: {
        '@id': 'role:editor1',
        '@type': 'ContributorRole',
        roleName: 'editor',
        editor: 'user:editor1'
      },
      author: [
        {
          '@id': 'role:author1',
          '@type': 'ContributorRole',
          roleName: 'author',
          author: {
            '@id': 'user:author1',
            '@type': 'Person'
          }
        }
      ],
      // Note editor cannot view identity of producer so we can test addition of sameAs
      // others (authors etc.) cannot view any identity
      hasDigitalDocumentPermission: {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: {
          '@type': 'Audience',
          audienceType: 'editor'
        },
        permissionScope: [
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
        ]
      }
    });

    const store = new Store(graph);

    it('should anonymize a graph action editable offline', async () => {
      // in this case we should just remove the user references so the document in the same in PouchDB and CouchDB
      const action = Object.assign(createId('action', null, graph), {
        '@type': 'AssessAction',
        actionStatus: 'ActiveActionStatus',
        agent: {
          '@id': getId(arrayify(graph.editor)[0]),
          '@type': 'ContributorRole',
          roleName: 'editor',
          agent: getId(arrayify(graph.editor)[0].editor)
        }
      });

      const anonymizedAction = await librarian.anonymize(action, {
        viewer: 'user:author1',
        store
      });

      // console.log(require('util').inspect(anonymizedAction, { depth: null }));

      assert(!anonymizedAction.agent.agent);
    });

    it('should sameAs identity for a graph action non editable offline (identity is visible case))', async () => {
      const action = Object.assign(createId('action', null, graph), {
        '@type': 'AssessAction',
        actionStatus: 'CompletedActionStatus',
        agent: {
          '@id': getId(arrayify(graph.editor)[0]),
          '@type': 'ContributorRole',
          roleName: 'editor',
          agent: getId(arrayify(graph.editor)[0].editor)
        }
      });

      const anonymizedAction = await librarian.anonymize(action, {
        viewer: 'user:editor1',
        store
      });

      // console.log(require('util').inspect(anonymizedAction, { depth: null }));

      assert(anonymizedAction.agent.agent.sameAs);
    });

    it('should anonymize a graph action non editable offline (identity is not visible case)', async () => {
      const action = Object.assign(createId('action', null, graph), {
        '@type': 'AssessAction',
        actionStatus: 'CompletedActionStatus',
        agent: {
          '@id': getId(arrayify(graph.editor)[0]),
          '@type': 'ContributorRole',
          roleName: 'editor',
          agent: getId(arrayify(graph.editor)[0].editor)
        }
      });

      const anonymizedAction = await librarian.anonymize(action, {
        viewer: 'user:author1',
        store
      });

      // console.log(require('util').inspect(anonymizedAction, { depth: null }));

      assert(anonymizedAction.agent.agent.startsWith('anon:'));
    });
  });
});
