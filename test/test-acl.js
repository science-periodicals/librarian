import assert from 'assert';
import { getId } from '@scipe/jsonld';
import {
  createId,
  validateRequiredPermissions,
  Acl,
  roleMatch,
  createCheckAcl,
  parseAuthorization,
  hasPublicAudience,
  hasPermission
} from '../src';

// Note `blindingData` is tested in test-anonymize
describe('acl', function() {
  describe('roleMatch', () => {
    it('should match in case of public audience', () => {
      const source = 'user:userId';
      const target = {
        '@type': 'AudienceRole',
        participant: {
          '@type': 'Audience',
          audienceType: 'public'
        }
      };

      assert(roleMatch(source, target));
    });

    it('should match in srole case (interesting as roleName mismatch))', () => {
      const roleId = createId('role')['@id'];
      const source = 'user:peter';
      const scope = {
        '@id': 'graph:graphId',
        '@type': 'Graph',
        editor: {
          '@id': roleId,
          '@type': 'ContributorRole',
          roleName: 'editor',
          editor: 'user:peter'
        }
      };

      const target = {
        '@id': createId('srole', null, roleId)['@id'],
        '@type': 'ContributorRole',
        roleName: 'assignee'
      };

      assert(
        roleMatch(source, target, {
          scopeId: getId(scope),
          scopes: [scope],
          requiresMatchingIdentity: true
        })
      );
    });
  });

  describe('ACL', () => {
    // this is the new Acl API, everything else will eventually be deprecated and removed
    describe('Periodical ACL', () => {
      describe('CreateGraphPermission', () => {
        it('should check for CreateGraphPermission when user has permission', () => {
          const periodical = {
            '@type': 'Periodical',
            hasDigitalDocumentPermission: {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'CreateGraphPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
            }
          };

          const acl = new Acl(periodical);
          assert(
            acl.checkPermission(
              { '@type': 'Audience', audienceType: 'public' },
              'CreateGraphPermission'
            )
          );
        });

        it("should check for CreateGraphPermission when user doesn't have permission", () => {
          const periodical = {
            '@type': 'Periodical',
            hasDigitalDocumentPermission: {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'ReadPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
            }
          };
          const acl = new Acl(periodical);
          assert(
            !acl.checkPermission(
              { '@type': 'Audience', audienceType: 'public' },
              'CreateGraphPermission'
            )
          );
        });
      });
    });

    describe('Graph & Graph Actions ACL', () => {
      describe('ReadPermission and ViewActionPermission', () => {
        it('should grant ReadPermission and ViewActionPermission to main entity contributors', () => {
          const graph = {
            '@type': 'Graph',
            '@id': 'graph:test',
            author: {
              '@type': 'ContributorRole',
              startDate: '2019-07-06T00:50:55.226Z',
              roleName: 'author',
              author: 'user:user1',
              '@id': 'role:role1'
            },
            editor: {
              '@type': 'ContributorRole',
              startDate: '2019-07-06T00:50:55.226Z',
              roleName: 'editor',
              editor: 'user:user3',
              '@id': 'role:role3'
            },
            hasDigitalDocumentPermission: [
              {
                '@type': 'DigitalDocumentPermission',
                grantee: { '@type': 'Audience', audienceType: 'author' },
                permissionType: 'ReadPermission'
              },
              {
                '@type': 'DigitalDocumentPermission',
                grantee: { '@type': 'Audience', audienceType: 'editor' },
                permissionType: 'ReadPermission'
              }
            ],
            mainEntity: 'node:mainEntity',
            '@graph': [
              {
                '@id': 'node:mainEntity',
                '@type': 'ScholarlyArticle',
                author: ['role:role2']
              },
              {
                '@id': 'role:role2',
                '@type': 'ContributorRole',
                author: 'user:user2',
                roleName: 'author'
              },
              {
                '@id': 'user:user2',
                '@type': 'Person'
              }
            ]
          };

          const action = {
            '@type': 'CreateReleaseAction',
            actionStatus: 'CompletedActionStatus',
            agent: {
              '@id': 'role:role1',
              '@type': 'ContributorRole',
              roleName: 'author',
              startDate: '2019-07-06T00:50:55.226Z'
            },
            participant: [
              {
                '@type': 'Audience',
                audienceType: 'author'
              }
            ],
            object: 'graph:test'
          };

          const acl = new Acl(graph);

          assert(acl.checkPermission('user:user1', 'ReadPermission'));
          assert(acl.checkPermission('user:user2', 'ReadPermission'));
          assert(acl.checkPermission('role:role1', 'ReadPermission'));
          assert(acl.checkPermission('role:role2', 'ReadPermission'));
          assert(acl.checkPermission('user:user3', 'ReadPermission'));
          assert(acl.checkPermission('role:role3', 'ReadPermission'));
          assert(!acl.checkPermission('user:unknown', 'ReadPermission'));
          assert(!acl.checkPermission('role:unknown', 'ReadPermission'));

          assert(
            acl.checkPermission('user:user1', 'ViewActionPermission', {
              action
            })
          );
          assert(
            acl.checkPermission('role:role1', 'ViewActionPermission', {
              action
            })
          );

          assert(
            acl.checkPermission('user:user2', 'ViewActionPermission', {
              action
            })
          );

          assert(
            acl.checkPermission('role:role2', 'ViewActionPermission', {
              action
            })
          );

          assert(
            !acl.checkPermission('user:user3', 'ViewActionPermission', {
              action
            })
          );
          assert(
            !acl.checkPermission('role:role3', 'ViewActionPermission', {
              action
            })
          );

          assert(
            !acl.checkPermission('user:unknown', 'ViewActionPermission', {
              action
            })
          );
          assert(
            !acl.checkPermission('role:unknown', 'ViewActionPermission', {
              action
            })
          );
        });
      });
    });
  });

  describe('parseAuthorization', () => {
    it('should parse auth header', () => {
      const { username, password } = parseAuthorization(
        'Basic MTgyYjllZmQtYTFlZS00ZDUxLWI2MGYtZjgwZTAyZGY4YjkwOjE1ZjYyZWIyLWE3YWUtNGFmYi05YWNlLWQ3NzExODczMTQzNg=='
      );
      assert.equal(username, '182b9efd-a1ee-4d51-b60f-f80e02df8b90');
      assert.equal(password, '15f62eb2-a7ae-4afb-9ace-d77118731436');
    });

    it('should return undefined if no header are present', () => {
      const { username, password } = parseAuthorization();
      assert.equal(username, undefined);
      assert.equal(password, undefined);
    });
  });

  describe('validateRequiredPermissions', function() {
    it('should throw on invalid data', function() {
      assert.throws(() => {
        validateRequiredPermissions(['graphId', 'invalidAccessKey', 3]);
      }, Error);
    });

    it('should validate valid data', function() {
      [
        'role',
        ['journalId'],
        ['journalId', 'ReadPermission'],
        ['journalId', 'ReadPermission'],
        ['journalId', 'ViewIdentityPermission', ['author', 'editor']],
        ['journalId', 'ViewIdentityPermission', 'author']
      ].forEach(value => {
        assert.doesNotThrow(() => {
          validateRequiredPermissions(value);
        }, Error);
      });
    });
  });

  describe('createCheckAcl', function() {
    const user = {
      '@id': 'user:userId',
      email: 'peter@peter.io'
    };
    const roles = ['admin'];
    const docs = [
      {
        '@id': 'graph:graphId',
        '@type': 'Graph',
        author: {
          '@type': 'ContributorRole',
          roleName: 'author',
          author: user['@id']
        },
        contributor: {
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          contributor: user['@id']
        },
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'author'
            }
          },
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'reviewer'
            }
          },
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'WritePermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'reviewer'
            }
          },
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ViewIdentityPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'reviewer'
            },
            permissionScope: [
              { '@type': 'Audience', audienceType: 'author' },
              { '@type': 'Audience', audienceType: 'producer' }
            ]
          }
        ]
      },
      {
        '@id': 'journalId',
        '@type': 'Periodical',
        author: {
          '@type': 'ContributorRole',
          roleName: 'author',
          author: user['@id']
        },
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'author'
            }
          }
        ]
      }
    ];

    it('should check permission with a role', function() {
      const check = createCheckAcl(user, roles, docs);
      assert(check('acl:admin'));
      assert(!check('invalidRole'));
    });

    it('should check permission with an object', function() {
      const check = createCheckAcl(user, roles, docs);
      assert(['acl:admin', ['graph:graphId', 'ReadPermission']].every(check));
      assert(!['acl:admin', ['graph:graphId2', 'ReadPermission']].every(check));
      assert(['acl:admin', ['journalId', 'ReadPermission']].every(check));

      assert(check(['graph:graphId', 'ViewIdentityPermission', []]));
      assert(check(['graph:graphId', 'ViewIdentityPermission', 'producer']));
      assert(check(['graph:graphId', 'ViewIdentityPermission', ['producer']]));
    });

    it('should check permission when roles and permissions are undefined', function() {
      const check = createCheckAcl(user);
      assert(
        ![
          'acl:admin',
          ['graphId', 'ViewIdentityPermission', ['reviewer', 'editor']]
        ].every(check)
      );
    });

    it('should check if the user contributes to the graphId', function() {
      const check = createCheckAcl(user, roles, docs);
      assert(check(['graph:graphId']));
    });

    it('should check identity', function() {
      const check = createCheckAcl(user);
      assert(check({ '@id': user['@id'] }));
      assert(!check({ '@id': 'user:unknown' }));
    });

    it('should check identity with roles', function() {
      const check = createCheckAcl(user);
      assert(check({ roleName: 'editor', agent: { '@id': user['@id'] } }));
      assert(!check({ roleName: 'editor', agent: { '@id': 'user:unknow' } }));
    });

    it('should check identity when agent is undefined', function() {
      const check = createCheckAcl(user);
      assert(check());
    });
  });

  describe('hasPublicAudience', () => {
    it('should return true if the graph has public audience', () => {
      const object = {
        hasDigitalDocumentPermission: {
          '@type': 'DigitalDocumentPermission',
          grantee: {
            '@type': 'Audience',
            audienceType: 'public'
          },
          permissionType: 'ReadPermission'
        }
      };
      assert.equal(hasPublicAudience(object), true);
    });
  });

  describe('hasPermission', () => {
    const object = {
      author: {
        roleName: 'author',
        author: 'user:peter'
      },
      producer: {
        roleName: 'producer',
        author: 'user:peter'
      },
      hasDigitalDocumentPermission: [
        {
          '@type': 'DigitalDocumentPermission',
          permissionType: 'ReadPermission',
          grantee: {
            '@type': 'Audience',
            audienceType: 'author'
          }
        },
        {
          '@type': 'DigitalDocumentPermission',
          permissionType: 'ViewIdentityPermission',
          grantee: {
            '@type': 'Audience',
            audienceType: 'author'
          },
          permissionScope: [
            {
              '@type': 'Audience',
              audienceType: 'editor'
            }
          ]
        }
      ]
    };

    it('should return true if agent contribute to the graph', () => {
      assert.equal(hasPermission(object, 'user:peter'), true);
    });

    it('should return true if agent has permission', () => {
      assert.equal(hasPermission(object, 'user:peter', 'ReadPermission'), true);
    });

    it('should return true if agent has scoped permission', () => {
      assert.equal(
        hasPermission(object, 'user:peter', 'ViewIdentityPermission', 'editor'),
        true
      );
    });
  });

  describe('action permission', () => {
    it('should handle roleName assignments', () => {
      const graph = {
        '@id': createId('graph')['@id'],
        '@type': 'Graph',
        hasDigitalDocumentPermission: [
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
          '@id': 'role:role',
          '@type': 'ContributorRole',
          roleName: 'editor',
          name: 'editor in chief',
          contributor: 'user:lea'
        },
        producer: {
          '@id': 'role:role',
          '@type': 'ContributorRole',
          roleName: 'producer',
          name: 'production editor',
          contributor: 'user:peter'
        }
      };
      const action = {
        '@type': 'AllocateAction',
        agent: {
          '@type': 'ContributorRole',
          roleName: 'producer'
        }
      };

      assert(
        hasPermission(graph, 'user:lea', action, 'AssignActionPermission')
      );
      assert(
        !hasPermission(graph, 'user:peter', action, 'AssignActionPermission')
      );
    });

    it('should check if user has PerformActionPermission', () => {
      const graphId = createId('graph')['@id'];
      const graph = {
        '@id': graphId,
        '@type': 'Graph',
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'WritePermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'editor'
            }
          }
        ],
        editor: [
          {
            '@id': 'role:role',
            '@type': 'ContributorRole',
            roleName: 'editor',
            name: 'editor in chief',
            editor: 'user:peter'
          },
          {
            '@id': 'role:role',
            '@type': 'ContributorRole',
            roleName: 'editor',
            name: 'associate editor',
            editor: 'user:lea'
          }
        ]
      };
      const action = {
        '@type': 'AssessAction',
        participant: {
          '@id': createId('audience', 'editor', graphId)['@id'],
          '@type': 'Audience',
          audienceType: 'editor'
        },
        agent: {
          '@type': 'ContributorRole',
          roleName: 'editor',
          name: 'editor in chief',
          'name-input': {
            '@type': 'PropertyValueSpecification',
            readonlyValue: true,
            valueRequired: true
          }
        }
      };

      assert(
        hasPermission(graph, 'user:peter', action, 'PerformActionPermission')
      );
      assert(
        !hasPermission(graph, 'user:lea', action, 'PerformActionPermission')
      );
    });

    it('should check if user has PerformActionPermission when action is assigned', () => {
      const graph = {
        '@id': createId('graph')['@id'],
        '@type': 'Graph',
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'WritePermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'reviewer'
            }
          }
        ],
        contributor: {
          '@id': 'role:role',
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          contributor: 'user:peter'
        }
      };
      const action = {
        '@type': 'ReviewAction',
        agent: {
          '@id': 'role:role',
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          agent: 'user:peter'
        }
      };

      assert(
        hasPermission(graph, 'user:peter', action, 'PerformActionPermission')
      );
      assert(
        !hasPermission(graph, 'user:joe', action, 'PerformActionPermission')
      );
    });
  });
});
