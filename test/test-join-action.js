import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  remapRole,
  getAgentId,
  ALL_AUDIENCES
} from '../src/';

describe('JoinAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    author,
    contrib,
    organization,
    periodical,
    workflowSpecification,
    graph;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();
    author = await registerUser();
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
                      audienceType: 'author'
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'reviewer'
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'producer'
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
        agent: author['@id'],
        participant: getId(createPeriodicalAction.result.editor[0]),
        result: {
          '@type': 'Graph',
          author: {
            '@type': 'ContributorRole',
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(createPeriodicalAction.result.editor[0]),
          mainEntity: '_:article',
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'ScholarlyArticle',
              author: {
                '@type': 'ContributorRole',
                roleName: 'author',
                author: getId(contrib)
              }
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );

    graph = createGraphAction.result;

    // console.log(require('util').inspect(graph, { depth: null }));
  });

  describe('join Graphs', () => {
    it('should join as an eic', async () => {
      const joinAction = await librarian.post(
        {
          '@type': 'JoinAction',
          actionStatus: 'CompletedActionStatus',
          agent: remapRole(
            arrayify(periodical.editor).find(role => role.name === 'eic'),
            'agent',
            { dates: false }
          ),
          object: graph['@id']
        },
        { acl: user }
      );

      // console.log(require('util').inspect(joinAction, { depth: null }));

      assert.equal(joinAction.actionStatus, 'CompletedActionStatus');

      const updatedGraph = joinAction.result;
      assert(arrayify(updatedGraph.editor).find(role => role.name === 'eic'));
    });

    it('should allow a main entity contrib to join', async () => {
      const contribRole = arrayify(graph['@graph']).find(
        node => getId(node.author) === getId(contrib)
      );

      const joinAction = await librarian.post(
        {
          '@type': 'JoinAction',
          actionStatus: 'CompletedActionStatus',
          agent: remapRole(contribRole, 'agent', { dates: false }),
          object: graph['@id']
        },
        { acl: contrib }
      );

      // console.log(require('util').inspect(joinAction, { depth: null }));

      assert.equal(joinAction.actionStatus, 'CompletedActionStatus');

      const updatedGraph = joinAction.result;
      assert(
        arrayify(updatedGraph.author).find(
          role => getAgentId(role) === getId(contrib)
        )
      );
    });
  });

  describe('Join Periodicals', () => {
    it('should join as producer', async () => {
      const joinAction = await librarian.post(
        {
          '@type': 'JoinAction',
          actionStatus: 'CompletedActionStatus',
          agent: {
            name: 'pic',
            roleName: 'producer',
            agent: getId(user)
          },
          object: getId(periodical)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(joinAction, { depth: null }));
      assert.equal(joinAction.actionStatus, 'CompletedActionStatus');

      const updatedGraph = joinAction.result;
      assert(arrayify(updatedGraph.producer).find(role => role.name === 'pic'));
    });
  });
});
