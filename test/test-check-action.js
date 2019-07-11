import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  getAgentId,
  getSourceRoleId
} from '../src/';

describe('CheckAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    contrib,
    organization,
    periodical,
    graph,
    createReleaseAction,
    checkActions;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser();
    contrib = await registerUser();

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
                  releaseRequirement: 'ProductionReleaseRequirement',
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
              author: {
                '@id': createId('role', null)['@id'],
                '@type': 'ContributorRole',
                roleName: 'author',
                author: getId(user)
              },
              contributor: {
                '@id': createId('role', null)['@id'],
                '@type': 'ContributorRole',
                roleName: 'author',
                contributor: getId(contrib)
              }
            }
          ]
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    checkActions = await librarian.getActionsByScopeIdAndTypes(getId(graph), [
      'CheckAction'
    ]);
    // console.log(require('util').inspect(checkActions, { depth: null }));
  });

  it('should have issued a CheckAction and let a graph author complete it', async () => {
    let checkAction = checkActions.find(
      action => getAgentId(action.agent) === getId(user)
    );
    assert(checkAction);
    // console.log(require('util').inspect(checkAction, { depth: null }));

    // check that the CheckAction was issued
    assert.equal(checkAction.actionStatus, 'ActiveActionStatus');

    checkAction = await librarian.post(
      Object.assign({}, checkAction, { actionStatus: 'CompletedActionStatus' }),
      { acl: user }
    );

    // console.log(require('util').inspect(checkAction, { depth: null }));
    assert.equal(checkAction.actionStatus, 'CompletedActionStatus');
  });

  it('should have issued a CheckAction and let a main entity contributor (not part of the Graph directly) complete it', async () => {
    let checkAction = checkActions.find(
      action => getAgentId(action.agent) === getId(contrib)
    );
    assert(checkAction);
    // console.log(require('util').inspect(checkAction, { depth: null }));

    // check that the CheckAction was issued
    assert.equal(checkAction.actionStatus, 'ActiveActionStatus');

    checkAction = await librarian.post(
      Object.assign({}, checkAction, { actionStatus: 'CompletedActionStatus' }),
      { acl: contrib }
    );

    // console.log(require('util').inspect(checkAction, { depth: null }));
    assert.equal(checkAction.actionStatus, 'CompletedActionStatus');

    // main entity contrib role id was added as participant
    const mainEntityContribRole = graph['@graph'].find(
      node => getAgentId(node.contributor) === getId(contrib)
    );

    assert(
      checkAction.participant.find(role => {
        const sourceRoleId = getSourceRoleId(role);
        return sourceRoleId === getId(mainEntityContribRole);
      })
    );
  });

  it('should allow the contributor to see the user CheckAction', async () => {
    const userCheckAction = checkActions.find(
      action => getAgentId(action.agent) === getId(user)
    );
    // console.log(require('util').inspect(userCheckAction, { depth: null }));

    const safe = await librarian.checkReadAcl(userCheckAction, {
      acl: contrib
    });

    assert(safe);
  });
});
