import assert from 'assert';
import uuid from 'uuid';
import { getAgentId } from 'schema.org/utils';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('AssignAction', function() {
  this.timeout(40000);

  let librarian, editor, producer, organization, periodical, graph;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [editor, producer] = await Promise.all(
      ['editor', 'producer'].map(id => registerUser())
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

    organization = createOrganizationAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        agent: {
          roleName: 'editor',
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
            editor: editor
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
              grantee: [
                {
                  '@type': 'Audience',
                  audienceType: 'editor'
                },
                {
                  '@type': 'Audience',
                  audienceType: 'producer'
                }
              ]
            }
          ].concat(
            ['editor', 'reviewer', 'author', 'producer'].map(audienceType => {
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
      { acl: editor }
    );

    periodical = createPeriodicalAction.result;

    // add producer to the periodical
    const periodicalInviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        agent: editor['@id'],
        actionStatus: 'ActiveActionStatus',
        recipient: {
          '@type': 'ContributorRole',
          roleName: 'producer',
          recipient: producer['@id']
        },
        object: periodical['@id']
      },
      { acl: editor['@id'] }
    );

    const periodicalAcceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: producer['@id'],
        object: periodicalInviteAction['@id']
      },
      { acl: producer['@id'] }
    );

    periodical = periodicalAcceptAction.result.result;

    const createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: editor['@id'],
        object: periodical['@id'],
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
      { acl: editor }
    );

    const workflowSpecification = createWorkflowSpecificationAction.result;

    //console.log(
    //  require('util').inspect(createPeriodicalAction, {
    //    depth: null
    //  })
    //);

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        object: workflowSpecification['@id'],
        agent: editor['@id'],
        result: {
          '@type': 'Graph',
          editor: {
            roleName: 'editor',
            agent: editor['@id']
          }
        }
      }),
      { acl: editor['@id'], skipPayments: true }
    );

    graph = createGraphAction.result;

    // add producer to graph
    const graphInviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'ActiveActionStatus',
        recipient: getId(arrayify(periodical.producer)[0]),
        object: graph['@id']
      },
      { acl: editor['@id'] }
    );

    const graphAcceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: producer['@id'],
        object: graphInviteAction['@id']
      },
      { acl: producer['@id'] }
    );

    graph = await librarian.get(graph['@id'], {
      acl: editor['@id'],
      potentialActions: 'all'
    });

    // console.log(require('util').inspect(graph, { depth: null }));
  });

  it('should perform an assign action and then unassign it', async () => {
    const reviewAction = graph.potentialAction.find(
      action => action['@type'] === 'ReviewAction'
    );

    const assignAction = await librarian.post(
      {
        '@type': 'AssignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        recipient: getId(arrayify(graph.producer)[0]),
        object: getId(reviewAction)
      },
      { acl: editor }
    );

    // console.log(require('util').inspect(assignAction, { depth: null }));

    assert.equal(
      assignAction.result.agent['@id'],
      getId(arrayify(graph.producer)[0]),
      'the action was assigned'
    );
    assert(
      assignAction.result.participant.some(
        participant =>
          participant.roleName === 'assigner' &&
          getAgentId(participant) === getAgentId(arrayify(graph.editor)[0])
      ),
      'the assigner was set'
    );

    assert(
      reviewAction.participant.every(participant => {
        return (
          participant.roleName === 'assigner' ||
          assignAction.result.participant.some(
            _participant => getId(_participant) === getId(participant)
          )
        );
      }),
      'pre-existing participant were kept'
    );

    // unassign
    const unassignAction = await librarian.post(
      {
        '@type': 'UnassignAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        object: getId(reviewAction)
      },
      { acl: editor }
    );

    assert.deepEqual(
      unassignAction.result.agent,
      reviewAction.agent,
      'template agent was brought back'
    );

    assert(
      reviewAction.participant.every(participant => {
        return participant.roleName !== 'assigner';
      }),
      'assigner was removed'
    );
  });
});
