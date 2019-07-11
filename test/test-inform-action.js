import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src';

describe('InformAction', function() {
  this.timeout(40000);

  describe('Standalone', () => {
    let librarian,
      user,
      user2,
      organization,
      periodical,
      createGraphAction,
      reviewAction,
      graph;
    before(async () => {
      librarian = new Librarian({ skipPayments: true });

      [user, user2] = await Promise.all(
        ['user', 'user2'].map(userId => registerUser())
      );

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
                grantee: user['@id']
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
                    '@type': 'ReviewAction',
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
            }
          }
        }),
        { acl: user, skipPayments: true }
      );

      graph = createGraphAction.result;
      reviewAction = graph.potentialAction.find(
        action => action['@type'] === 'ReviewAction'
      );

      // add user 2 to graph
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          recipient: {
            roleName: 'author',
            recipient: user2['@id']
          },
          object: graph['@id']
        },
        { acl: user }
      );

      // make the recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: user2['@id'],
          object: inviteAction['@id']
        },
        { acl: user2 }
      );
      graph = acceptAction.result.result;
    });

    it('should handle a inform action with a well defined email', async () => {
      const informAction = await librarian.post(
        {
          '@type': 'InformAction',
          agent: user['@id'],
          recipient: {
            roleName: 'author',
            recipient: user2['@id']
          },
          object: getId(reviewAction),
          actionStatus: 'CompletedActionStatus',
          instrument: {
            '@type': 'EmailMessage',
            sender: {
              name: 'sci.pe',
              email: 'mailto:notifications@sci.pe'
            },
            recipient: user2['@id'],
            about: graph['@id'],
            description: 'hello',
            text: {
              '@type': 'sa:ejs',
              '@value':
                "<p>Hello ejs tempate about a <%= locals.emailMessage.about[0]['@type'] %></p>"
            }
          }
        },
        { acl: user }
      );

      // console.log(require('util').inspect(informAction, { depth: null }));
      assert(informAction.instrument['@id'], 'email has an @id');
      assert(
        informAction.instrument.identifier.startsWith('ses:'),
        'email has an AWS SES identifier'
      );
    });

    it('should handle a inform action with a minimal email message', async () => {
      const informAction = await librarian.post(
        {
          '@type': 'InformAction',
          agent: user['@id'],
          recipient: {
            roleName: 'author',
            recipient: user2['@id']
          },
          actionStatus: 'CompletedActionStatus',
          object: getId(reviewAction),
          instrument: {
            '@type': 'EmailMessage'
          }
        },
        { acl: user }
      );

      // console.log(require('util').inspect(informAction, { depth: null }));
      assert(informAction.instrument['@id'], 'email has an @id');
      assert(
        informAction.instrument.identifier.startsWith('ses:'),
        'email has an AWS SES identifier'
      );
    });
  });

  describe('As potential action', () => {
    let librarian, user, organization, periodical, createGraphAction, graph;
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
            editor: {
              roleName: 'editor',
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
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType: 'public'
                }
              },
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: user['@id']
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
                    '@type': 'ReviewAction',
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

      const defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');

      createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          result: {
            '@type': 'Graph',
            editor: {
              roleName: 'editor',
              editor: getId(user)
            }
          }
        }),
        { acl: user, skipPayments: true }
      );

      graph = createGraphAction.result;
    });

    it('should issue a inform action in case of an invite action (simulates inviting new reviewers)', async () => {
      const recipient = {
        email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
      };

      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: user['@id'],
          recipient: {
            roleName: 'reviewer',
            recipient
          },
          object: graph['@id'],
          potentialAction: {
            '@type': 'InformAction',
            actionStatus: 'CompletedActionStatus',
            agent: user['@id'],
            recipient: {
              roleName: 'reviewer',
              recipient
            },
            instrument: {
              '@type': 'EmailMessage',
              description: 'hello',
              text: 'world'
            }
          }
        },
        { acl: user }
      );

      // console.log(require('util').inspect(inviteAction, { depth: null }));
      const informAction = arrayify(inviteAction.potentialAction).find(
        action => action['@type'] === 'InformAction'
      );
      assert.equal(informAction.actionStatus, 'CompletedActionStatus');
    });
  });
});
