import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src';

describe('hydrate', function() {
  this.timeout(40000);

  let librarian,
    user,
    user2,
    organization,
    periodical,
    createGraphAction,
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

  it('should hydrate', async () => {
    const action = {
      '@type': 'InformAction',
      agent: user['@id'],
      participant: {
        '@type': 'Role',
        participant: user2['@id']
      },
      recipient: [
        user['@id'],
        {
          '@type': 'Role',
          recipient: user2['@id']
        }
      ],
      object: graph['@id'],
      instrument: {
        '@type': 'EmailMessage',
        about: graph['@id']
      }
    };

    const nodeMap = await librarian.hydrate(action, { acl: user });
    // console.log(require('util').inspect(nodeMap, { depth: null }));

    assert.equal(nodeMap[action.agent]['@type'], 'Person');
    assert.equal(nodeMap[action.participant.participant]['@type'], 'Person');
    assert.equal(nodeMap[action.recipient[0]]['@type'], 'Person');
    assert.equal(nodeMap[action.recipient[1].recipient]['@type'], 'Person');
    assert.equal(nodeMap[action.object]['@type'], 'Graph');
    assert.equal(nodeMap[action.instrument.about]['@type'], 'Graph');
  });
});
