import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('DeclareAction (and ReplyAction)', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical, graph;
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
              permissionType: 'AdminPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'editor'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'ReadPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
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
                  '@type': 'DeclareAction',
                  agent: {
                    roleName: 'author'
                  },
                  participant: {
                    '@type': 'Audience',
                    audienceType: 'author'
                  },
                  question: {
                    '@type': 'Question',
                    text: 'Were experimental animals used?'
                  },
                  potentialAction: {
                    '@type': 'AuthorizeAction',
                    actionStatus: 'PotentialActionStatus',
                    completeOn: 'OnObjectCompletedActionStatus',
                    recipient: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    }
                  }
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
          }
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;
  });

  it('should have properly initialized the DeclareAction result with @id', () => {
    const declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );

    assert(declareAction.result['@id'], 'an @id has been set');
    assert.equal(
      declareAction.result.parentItem,
      declareAction.question['@id'],
      'parentItem has been set'
    );
  });

  it('should answer the question and this should allow the completion of the DeclareAction and also backport previous answer (result) when user stage or complete the declaration without re-including them while still allowing to edit them', async () => {
    let declareAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'DeclareAction'
    );

    const question = arrayify(declareAction.question)[0];
    // console.log(require('util').inspect(question, { depth: null }));

    const replyAction = await librarian.post(
      {
        '@type': 'ReplyAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        object: question['@id'],
        resultComment: {
          '@type': 'Answer',
          text: 'No.'
        }
      },
      { acl: user }
    );

    // console.log(require('util').inspect(replyAction, { depth: null }));
    // check that result @id was preserved
    assert.equal(getId(replyAction.result.result), getId(declareAction.result));

    declareAction = replyAction.result;

    assert(
      declareAction.participant.some(
        participant => participant.roleName === 'author'
      ),
      'parent action (DeclareAction) participant was appended'
    );

    // stage the declare action (test that the answer remains)
    declareAction = await librarian.post(
      Object.assign({}, declareAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: user }
    );
    // console.log(require('util').inspect(declareAction, { depth: null }));
    assert.equal(declareAction.result.text, 'No.');

    // test that answer can be mutated
    declareAction = await librarian.post(
      Object.assign({}, declareAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        result: Object.assign({}, declareAction.result, { text: 'Yes.' })
      }),
      { acl: user }
    );
    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert.equal(declareAction.result.text, 'Yes.');

    // complete the DeclareAction
    const completedDeclareAction = await librarian.post(
      Object.assign({}, declareAction, {
        agent: getId(arrayify(graph.author)[0]),
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: user }
    );
    assert.equal(declareAction.result.text, 'Yes.');

    // console.log(require('util').inspect(completedDeclareAction, { depth: null }));
    assert.equal(completedDeclareAction.actionStatus, 'CompletedActionStatus');

    assert(getId(completedDeclareAction.result), getId(declareAction.result));
    // @id and parentItem are preserved
    assert(
      getId(completedDeclareAction.result.parentItem),
      getId(declareAction.result.parentItem)
    );
  });
});
