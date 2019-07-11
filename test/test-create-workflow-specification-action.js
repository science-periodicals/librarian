import assert from 'assert';
import uuid from 'uuid';
import { arrayify, getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src';

describe('CreateWorkflowSpecificationAction', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical;
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
          hasDigitalDocumentPermission: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'editor'
            }
          },
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: user
          }
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;
  });

  it('should create a WorkflowSpecification ', async () => {
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
              potentialAction: {
                '@id': '_:submission',
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@id': '_:reviewAction',
                    '@type': 'ReviewAction',
                    actionStatus: 'ActiveActionStatus',
                    agent: {
                      roleName: 'reviewer'
                    },
                    participant: {
                      '@type': 'Audience',
                      audienceType: 'editor'
                    },
                    potentialAction: {
                      '@type': 'EndorseAction',
                      actionStatus: 'PotentialActionStatus',
                      agent: {
                        roleName: 'author'
                      },
                      participant: {
                        '@type': 'Audience',
                        audienceType: 'author'
                      }
                    }
                  },
                  {
                    '@id': '_:assessAction',
                    '@type': 'AssessAction',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'reviewer'
                      }
                    ],
                    potentialResult: [
                      {
                        '@id': '_:revision',
                        '@type': 'StartWorkflowStageAction',
                        participant: ALL_AUDIENCES,
                        name: 'revision stage',
                        result: {
                          '@type': 'CreateReleaseAction',
                          agent: { roleName: 'author' },
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
                            }
                          ]
                        }
                      },
                      {
                        '@id': '_:production',
                        '@type': 'StartWorkflowStageAction',
                        participant: ALL_AUDIENCES,
                        name: 'production stage',
                        result: {
                          '@type': 'PublishAction',
                          agent: { roleName: 'editor' },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        }
                      },
                      {
                        '@id': '_:rejection',
                        '@type': 'RejectAction',
                        name: 'rejection stage'
                      }
                    ],
                    potentialAction: [
                      {
                        '@type': 'InformAction',
                        name: 'revision letter',
                        ifMatch: '_:revision',
                        instrument: {
                          '@type': 'EmailMessage',
                          about: '_:assessAction',
                          messageAttachment: '_:reviewAction'
                        }
                      },
                      {
                        '@type': 'InformAction',
                        name: 'production letter',
                        ifMatch: '_:production',
                        instrument: {
                          '@type': 'EmailMessage',
                          about: '_:assessAction',
                          messageAttachment: '_:reviewAction'
                        }
                      },
                      {
                        '@type': 'InformAction',
                        name: 'rejection letter',
                        ifMatch: '_:rejection',
                        instrument: {
                          '@type': 'EmailMessage',
                          about: '_:assessAction',
                          messageAttachment: '_:reviewAction'
                        }
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      { acl: user }
    );

    // console.log(
    //   require('util').inspect(createWorkflowSpecificationAction, {
    //     depth: null
    //   })
    // );

    const workflowSpecification = createWorkflowSpecificationAction.result;

    const updatedPeriodical = await librarian.get(getId(periodical), {
      acl: user
    });

    assert(workflowSpecification);
    assert(updatedPeriodical);
    assert(
      arrayify(updatedPeriodical.potentialWorkflow).some(
        id => id === getId(workflowSpecification)
      )
    );

    // test relabeling
    const nodes = workflowSpecification.potentialAction.result['@graph'];

    const stages = nodes.filter(
      node =>
        node['@type'] === 'StartWorkflowStageAction' ||
        node['@type'] === 'RejectAction'
    );

    const informActions = nodes.filter(
      node => node['@type'] === 'InformAction'
    );
    // check that ifMatch was propertly relabed
    assert(
      informActions.every(informAction =>
        stages.some(stage => getId(stage) === informAction.ifMatch)
      )
    );

    // check the EmailMessage got a workflow @id and that InformAcitons where properly updated
    const emailMessages = nodes.filter(
      node => node['@type'] === 'EmailMessage'
    );

    assert(
      emailMessages.every(emailMessage =>
        getId(emailMessage).startsWith('workflow:')
      )
    );

    assert(
      informActions.every(informAction =>
        emailMessages.some(
          emailMessage => getId(emailMessage) === getId(informAction.instrument)
        )
      )
    );

    // test that audience was added to EndorseAction
    const endorseAction = nodes.find(node => node['@type'] === 'EndorseAction');
    const participant = nodes.find(
      node => getId(node) === getId(endorseAction.participant)
    );
    assert.equal(participant['@type'], 'Audience');
  });
});
