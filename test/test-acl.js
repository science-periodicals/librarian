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
  hasPermission,
  getDefaultGraphDigitalDocumentPermissions
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

        it('should handle invite with a purpose', () => {
          const action = {
            '@id': 'action:reviewId',
            '@type': 'ReviewAction',
            actionStatus: 'ActiveActionStatus',
            agent: { '@type': 'ContributorRole', roleName: 'reviewer' },
            description: 'Review the submission.',
            name: 'Review',
            instanceIndex: 1,
            startTime: '2019-07-10T23:17:34.657Z',
            instanceOf: 'workflow:reviewId',
            resultOf: 'action:startWorkflowStageId',
            object: 'graph:graphId?version=0.0.0-0',
            _id: 'graph:graphId::action::action:reviewId'
          };

          const graph = {
            creator: 'user:brown',
            '@id': 'graph:graphId',
            '@type': 'Graph',
            author: {
              '@id': 'role:a3e0b07d-37b3-4f54-815e-debbdb043198',
              '@type': 'ContributorRole',
              startDate: '2019-07-10T23:17:27.435Z',
              roleName: 'author',
              author: 'user:brown'
            },
            reviewer: [
              {
                '@id': 'role:39b7c2b3-d704-493c-b303-da61785d7ea6',
                '@type': 'ContributorRole',
                roleName: 'reviewer',
                reviewer: 'user:noether',
                startDate: '2019-07-10T23:17:35.855Z'
              }
            ],
            editor: [
              {
                '@type': 'ContributorRole',
                '@id': 'role:5f6bf6d9-af79-475a-8e8b-78e80b0c4fa7',
                name: 'Editorial Office',
                roleName: 'editor',
                roleContactPoint: [
                  {
                    '@id': 'contact:user-rubin@editorial-office',
                    '@type': 'ContactPoint',
                    contactType: 'editorial office',
                    email: 'mailto:test+rubin@sci.pe',
                    verificationStatus: 'VerifiedVerificationStatus'
                  }
                ],
                editor: 'user:rubin',
                startDate: '2019-07-10T23:17:27.435Z'
              }
            ],
            hasDigitalDocumentPermission: getDefaultGraphDigitalDocumentPermissions(),
            dateCreated: '2019-07-10T23:17:27.422Z',
            expectedDatePublishedOrRejected: '2019-08-24T23:17:27.422Z',
            identifier: 2,
            isPartOf: 'journal:joghl-test',
            publisher: 'org:institute-for-advanced-studies',
            workflow:
              'workflow:83b11b6a-b7ee-4611-8e5a-fb374b32aacb?version=2-b933a9bb299b9fca1220b8450ee1fcc7',
            resultOf: 'action:64592c01-fa52-485f-956e-27ed12dbc662',
            mainEntity: 'node:02f7abe9-f4af-41ba-8550-076f903441a3',
            dateSubmitted: '2019-07-10T23:17:31.799Z',
            _id: 'graph:graphId::graph'
          };

          const invite = {
            startTime: '2019-07-10T23:17:35.702Z',
            '@id': 'action:inviteId',
            '@type': 'InviteAction',
            actionStatus: 'ActiveActionStatus',
            agent: {
              '@id': 'role:5f6bf6d9-af79-475a-8e8b-78e80b0c4fa7',
              '@type': 'ContributorRole',
              name: 'Editorial Office',
              roleName: 'editor',
              roleContactPoint: [
                {
                  '@id': 'contact:user-rubin@editorial-office',
                  '@type': 'ContactPoint',
                  contactType: 'editorial office',
                  email: 'mailto:test+rubin@sci.pe',
                  verificationStatus: 'VerifiedVerificationStatus'
                }
              ],
              agent: 'user:rubin'
            },
            recipient: {
              '@id': 'role:a50c6776-03ba-402c-b904-ad8ab7c9a67c',
              '@type': 'ContributorRole',
              roleName: 'reviewer',
              recipient: 'user:anning'
            },
            object: 'graph:graphId',
            purpose: 'action:reviewId',
            participant: [
              {
                '@type': 'AudienceRole',
                startDate: '2019-07-10T23:17:35.702Z',
                roleName: 'audience',
                participant: {
                  '@type': 'Audience',
                  audienceType: 'author',
                  '@id': 'audience:c3da13f68274e527e1ff19002073dae2'
                },
                '@id': 'arole:00d7ec7f-c313-4b12-9173-9e9d81db3718'
              },
              {
                '@type': 'AudienceRole',
                startDate: '2019-07-10T23:17:35.702Z',
                roleName: 'audience',
                participant: {
                  '@type': 'Audience',
                  audienceType: 'editor',
                  '@id': 'audience:1b41502812518176985ab77ad1b5e6d8'
                },
                '@id': 'arole:327d4bfd-3f84-44fe-a23b-9cd030bc1536'
              },
              {
                '@type': 'AudienceRole',
                startDate: '2019-07-10T23:17:35.702Z',
                roleName: 'audience',
                participant: {
                  '@type': 'Audience',
                  audienceType: 'reviewer',
                  '@id': 'audience:93968274b24b0118b967254c3bb6e4f8'
                },
                '@id': 'arole:ba3db81c-9db3-4616-8507-76e35de47cb4'
              },
              {
                '@type': 'AudienceRole',
                startDate: '2019-07-10T23:17:35.702Z',
                roleName: 'audience',
                participant: {
                  '@type': 'Audience',
                  audienceType: 'producer',
                  '@id': 'audience:71ff0cbf138024d0ba733a1f8ee6c70b'
                },
                '@id': 'arole:def15551-df6f-42ba-8454-4194c735b858'
              },
              {
                '@id':
                  'srole:e2506873-6c47-4417-a345-784f48aeac2e@a3e0b07d-37b3-4f54-815e-debbdb043198',
                '@type': 'ContributorRole',
                roleName: 'participant',
                startDate: '2019-07-10T23:17:35.702Z',
                participant: 'user:brown'
              },
              {
                '@id':
                  'srole:7de43734-a26e-454a-af17-769347cdec8c@5f6bf6d9-af79-475a-8e8b-78e80b0c4fa7',
                '@type': 'ContributorRole',
                roleName: 'participant',
                startDate: '2019-07-10T23:17:35.702Z',
                participant: 'user:rubin'
              },
              {
                '@id':
                  'srole:f6da33ed-bc51-4b8d-a026-0526dacaee44@39b7c2b3-d704-493c-b303-da61785d7ea6',
                '@type': 'ContributorRole',
                roleName: 'participant',
                startDate: '2019-07-10T23:17:36.002Z',
                participant: 'user:noether'
              }
            ],
            _id: 'graph:graphId::action::action:inviteId'
          };

          const acl = new Acl(graph, invite);

          // `user:noether` is reviewer, `user:anning` has been invited with a
          // purpose to `action`
          assert(
            !acl.checkPermission('user:noether', 'ViewActionPermission', {
              action
            })
          );
          assert(
            acl.checkPermission('user:anning', 'ViewActionPermission', {
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
