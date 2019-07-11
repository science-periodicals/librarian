import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

// Note: cancelation of webify actions is tested in test-webify-action

describe('CancelAction', function() {
  this.timeout(40000);

  describe('cancel polyton action (review)', function() {
    let librarian, author, editor, organization, periodical, graph;
    before(async () => {
      librarian = new Librarian({ skipPayments: true });

      [author, editor] = await Promise.all(
        ['author', 'editor'].map(name => {
          return registerUser();
        })
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
          actionStatus: 'CompletedActionStatus',
          agent: editor['@id'],
          object: organization['@id'],
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            name: 'my journal',
            editor: {
              roleName: 'editor',
              editor: getId(editor)
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
                grantee: [
                  editor['@id'],
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              }
            ]
          }
        },
        { acl: editor }
      );

      periodical = createPeriodicalAction.result;

      const createWorkflowSpecificationAction = await librarian.post(
        {
          '@type': 'CreateWorkflowSpecificationAction',
          agent: getId(editor),
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
                    agent: { roleName: 'editor' },
                    completeOn: 'OnEndorsed',
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    minInstances: 1,
                    maxInstances: 2,
                    potentialAction: {
                      '@id': '_:endorseAction',
                      '@type': 'EndorseAction',
                      actionStatus: 'PotentialActionStatus',
                      activateOn: 'OnObjectStagedActionStatus',
                      agent: { roleName: 'editor' },
                      participant: {
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
        { acl: editor }
      );

      const workflowSpecification = createWorkflowSpecificationAction.result;

      const defaultCreateGraphAction = arrayify(
        workflowSpecification.potentialAction
      ).find(action => action['@type'] === 'CreateGraphAction');

      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: author['@id'],
          participant: getId(arrayify(periodical.editor)[0]),
          result: {
            '@type': 'Graph',
            editor: getId(arrayify(periodical.editor)[0]),
            author: {
              roleName: 'author',
              author: getId(author)
            }
          }
        }),
        { acl: author, skipPayments: true }
      );

      graph = createGraphAction.result;
    });

    it('should cancel a reviewAction and the associated endorse action and error when trying to cancel below min instances', async () => {
      const reviewActions = arrayify(graph.potentialAction).filter(
        result => result['@type'] === 'ReviewAction'
      );
      const endorseAction = arrayify(graph.potentialAction).find(
        result => result['@type'] === 'EndorseAction'
      );

      const cancelAction = await librarian.post(
        {
          '@type': 'CancelAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          object: getId(reviewActions[0])
        },
        { acl: editor }
      );

      // console.log(require('util').inspect(cancelAction, { depth: null }));
      assert.equal(cancelAction.result.actionStatus, 'CanceledActionStatus');

      // check that endorse was canceled:
      const canceledEndorseAction = await librarian.get(endorseAction, {
        acl: false
      });
      assert.equal(canceledEndorseAction.actionStatus, 'CanceledActionStatus');

      // check that it was synced within the stage
      const stage = await librarian.get(endorseAction.resultOf, {
        acl: false
      });

      const embeddedCanceledReviewAction = stage.result.find(
        action =>
          action['@type'] === 'ReviewAction' &&
          action.actionStatus === 'CanceledActionStatus'
      );
      assert(embeddedCanceledReviewAction);
      assert(
        arrayify(embeddedCanceledReviewAction.potentialAction).some(
          action =>
            getId(action) &&
            getId(canceledEndorseAction) &&
            action.actionStatus === 'CanceledActionStatus'
        )
      );

      // test that we can't cancel below minInstances
      await assert.rejects(
        librarian.post(
          {
            '@type': 'CancelAction',
            actionStatus: 'CompletedActionStatus',
            agent: getId(arrayify(graph.editor)[0]),
            object: getId(reviewActions[1])
          },
          { acl: editor }
        ),
        {
          code: 403
        }
      );
    });
  });
});
