import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify, unrole } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('AuthorizeAction', function() {
  this.timeout(40000);

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
          editor: [
            {
              roleName: 'editor',
              editor: user
            },
            {
              name: 'eic',
              roleName: 'editor',
              editor: user
            }
          ],
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
                  participant: [
                    {
                      '@type': 'Audience',
                      audienceType: 'reviewer'
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

    // console.log(require('util').inspect(graph, { depth: null }));
  });

  describe('Authorize Action to add Periodical permission', () => {
    it('should make the periodical public', async () => {
      const authorizeAction = await librarian.post(
        {
          '@type': 'AuthorizeAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          object: getId(periodical),
          instrument: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'public'
            }
          }
        },
        { acl: user }
      );
      // console.log(require('util').inspect(authorizeAction, { depth: null }));
      assert(
        authorizeAction.result.hasDigitalDocumentPermission.some(
          permission => permission.grantee.audienceType === 'public'
        )
      );
    });
  });

  describe('Authorize Action to add graph action audience', () => {
    it('should add editor audience to the ReviewAction', async () => {
      const reviewAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'ReviewAction'
      );

      const authorizeAction = await librarian.post(
        {
          '@type': 'AuthorizeAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          object: getId(reviewAction),
          recipient: {
            '@type': 'Audience',
            audienceType: 'editor'
          }
        },
        { acl: user }
      );
      // console.log(require('util').inspect(authorizeAction, { depth: null }));

      assert(
        arrayify(authorizeAction.result.participant).some(participant => {
          const unroled = unrole(participant, 'participant');
          return unroled && unroled.audienceType === 'editor';
        })
      );
    });
  });
});
