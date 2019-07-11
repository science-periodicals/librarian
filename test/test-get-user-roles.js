import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  getDefaultPeriodicalDigitalDocumentPermissions,
  getDefaultGraphDigitalDocumentPermissions
} from '../src';

describe('get-user-roles', function() {
  this.timeout(40000);
  let librarian = new Librarian({ skipPayments: true });
  let user, periodical, organization, workflowSpecification, graph;

  before(async () => {
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
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          editor: {
            roleName: 'editor',
            editor: getId(user)
          },
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true, publicReadPermission: true }
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
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'WorkflowSpecification',
          expectedDuration: 'P60D',
          potentialAction: {
            '@type': 'CreateGraphAction',
            agent: {
              '@type': 'Role',
              roleName: 'author'
            },
            participant: ALL_AUDIENCES,
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: getDefaultGraphDigitalDocumentPermissions(),
              // Submission stage
              potentialAction: {
                '@id': '_:submissionStage',
                '@type': 'StartWorkflowStageAction',
                name: 'Submission Stage',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@id': '_:declareAction',
                    '@type': 'DeclareAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'author'
                    },
                    participant: ALL_AUDIENCES,
                    name: 'Ethical compliance'
                  }
                ]
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
        agent: { agent: getId(user), roleName: 'author' },
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          editor: getId(arrayify(periodical.editor)[0]),
          author: {
            roleName: 'author',
            author: getId(user)
          }
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    // Complete declareAction to test `roleAction`
    let declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );
    await librarian.post(
      Object.assign({}, declareAction, {
        agent: getId(arrayify(graph.author)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: user }
    );
  });

  it('should get list of roles for the userId', async () => {
    const roles = await librarian.getUserRoles(getId(user));

    // console.log(require('util').inspect(roles, { depth: null }));

    assert.equal(roles.length, 3);
    assert(roles.every(role => role['@type'] === 'ContributorRole'));
    assert(
      roles.some(role =>
        arrayify(role.roleAction).some(
          action => action['@type'] === 'DeclareAction'
        )
      )
    );

    // check that journal data is embedded
    assert(
      roles.some(
        role =>
          role.isNodeOf &&
          role.isNodeOf.isPartOf &&
          role.isNodeOf.isPartOf['@type'] === 'Periodical'
      )
    );
  });
});
