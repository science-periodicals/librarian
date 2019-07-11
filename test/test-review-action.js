import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('ReviewAction', function() {
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
              grantee: [
                user['@id'],
                { '@type': 'Audience', audienceType: 'editor' },
                { '@type': 'Audience', audienceType: 'author' },
                { '@type': 'Audience', audienceType: 'reviewer' },
                { '@type': 'Audience', audienceType: 'producer' }
              ]
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
                  ],
                  minInstances: 1,
                  maxInstances: 2,
                  answer: {
                    '@type': 'Answer',
                    parentItem: {
                      '@type': 'Question',
                      text: 'Is methionine mentioned ?'
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

  it('should have instantiated several review actions as dictated by the maxInstances property', () => {
    // console.log(require('util').inspect(graph, { depth: null }));
    const reviewActions = arrayify(graph.potentialAction).filter(
      result => result['@type'] === 'ReviewAction'
    );
    assert.equal(reviewActions.length, 2);
    assert(
      getId(reviewActions[0]) &&
        getId(reviewActions[0]) !== getId(reviewActions[1]),
      'actions have been given diferent @id'
    );

    assert(
      getId(reviewActions[0].answer.parentItem) &&
        getId(reviewActions[0].answer.parentItem) !==
          getId(reviewActions[1].answer.parentItem),
      'questions have been given diferent @id'
    );

    assert(
      getId(reviewActions[0].resultReview) &&
        getId(reviewActions[0].resultReview) !==
          getId(reviewActions[1].resultReview),
      'action reviews have been given diferent @id'
    );
  });

  it('should complete a question of the ReviewAction and complete the review and also backport previous answer when user stage or complete review without re-including them while still allowing to edit them', async () => {
    let reviewAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'ReviewAction'
    );

    const question = reviewAction.answer.parentItem;

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

    // console.log(require('util').inspect(reviewAction, { depth: null }));

    // check that answer and question @id were preserved
    assert.equal(getId(replyAction.result.answer), getId(reviewAction.answer));
    assert.equal(
      getId(replyAction.result.answer.parentItem),
      getId(reviewAction.answer.parentItem)
    );

    reviewAction = replyAction.result;
    assert.equal(reviewAction.answer.text, 'No.');

    // stage the review (test that the answer remains)
    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: user }
    );
    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert.equal(reviewAction.answer.text, 'No.');

    // test that answer can be mutated
    reviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        actionStatus: 'StagedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        answer: Object.assign({}, reviewAction.answer, { text: 'Yes.' })
      }),
      { acl: user }
    );
    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert.equal(reviewAction.answer.text, 'Yes.');

    // complete review action
    const completedReviewAction = await librarian.post(
      Object.assign({}, reviewAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        resultReview: {
          '@type': 'Review',
          reviewBody: 'All good',
          reviewRating: {
            '@type': 'Rating',
            bestRating: 5,
            ratingValue: 4,
            worstRating: 1
          }
        }
      }),
      { acl: user }
    );

    // console.log(require('util').inspect(reviewAction, { depth: null }));
    assert.equal(reviewAction.answer.text, 'Yes.');

    assert.equal(completedReviewAction.actionStatus, 'CompletedActionStatus');
    // check that review @id was backported
    assert.equal(
      getId(reviewAction.resultReview),
      getId(completedReviewAction.resultReview)
    );
  });
});
