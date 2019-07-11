import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('LeaveAction', function() {
  this.timeout(40 * 1000);

  let librarian, user, organization, periodical, workflowSpecification, graph;

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
                  expectedDuration: 'P2D',
                  agent: { '@type': 'Role', roleName: 'producer' },
                  participant: ALL_AUDIENCES
                }
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

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        participant: createPeriodicalAction.result.editor[0],
        result: {
          '@type': 'Graph',
          editor: {
            roleName: 'editor',
            editor: user['@id']
          }
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    // console.log(
    //   require('util').inspect(graph, {
    //     depth: null
    //   })
    // );
  });

  describe('Leave Graph', () => {
    it('should leave a Graph as a role', async () => {
      const roleId = getId(arrayify(graph.editor)[0]);
      const leaveAction = await librarian.post(
        {
          '@type': 'LeaveAction',
          actionStatus: 'CompletedActionStatus',
          agent: roleId,
          object: graph['@id']
        },
        { acl: user }
      );
      // console.log(require('util').inspect(leaveAction, { depth: null }));

      assert(
        arrayify(leaveAction.result.editor).find(role => getId(role) === roleId)
          .endDate
      );
    });
  });

  describe('Leave Periodical', () => {
    it('should leave a Periodical', async () => {
      const roleId = getId(arrayify(periodical.editor)[0]);
      const leaveAction = await librarian.post(
        {
          '@type': 'LeaveAction',
          actionStatus: 'CompletedActionStatus',
          agent: roleId,
          object: periodical['@id']
        },
        { acl: user }
      );
      // console.log(require('util').inspect(leaveAction, { depth: null }));

      assert(
        arrayify(leaveAction.result.editor).find(role => getId(role) === roleId)
          .endDate
      );
    });
  });

  describe('Leave Organization', () => {
    it('should leave an Organization', async () => {
      const roleId = getId(arrayify(organization.member)[0]);
      const leaveAction = await librarian.post(
        {
          '@type': 'LeaveAction',
          actionStatus: 'CompletedActionStatus',
          agent: roleId,
          object: organization['@id']
        },
        { acl: user }
      );
      // console.log(require('util').inspect(leaveAction, { depth: null }));

      assert(
        arrayify(leaveAction.result.member).find(role => getId(role) === roleId)
          .endDate
      );
    });
  });
});
