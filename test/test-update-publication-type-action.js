import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('UpdateAction (PublicationType)', function() {
  this.timeout(40000);

  let librarian,
    user,
    organization,
    periodical,
    publicationType,
    workflowSpecification;

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
            '@type': 'ContributorRole',
            roleName: 'editor',
            name: 'editor in chief',
            editor: user['@id']
          },
          hasDigitalDocumentPermission: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: user['@id']
          }
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;

    // Create a PublicationType
    const createPublicationTypeAction = await librarian.post(
      {
        '@type': 'CreatePublicationTypeAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'PublicationType',
          name: 'Research article',
          objectSpecification: {
            '@type': 'Graph',
            mainEntity: {
              '@type': 'ScholarlyArticle'
            }
          }
        }
      },
      { acl: user }
    );

    publicationType = createPublicationTypeAction.result;

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
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: {
                  '@type': 'DeclareAction',
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

    workflowSpecification = createWorkflowSpecificationAction.result;
  });

  it('should update a PublicationType', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        ifMatch: publicationType._rev,
        object: {
          eligibleWorkflow: getId(workflowSpecification),
          objectSpecification: {
            '@type': 'Graph',
            mainEntity: {
              '@type': 'ScholarlyArticle',
              'description-input': {
                '@type': 'PropertyValueSpecification',
                valueRequired: true,
                valueMaxlength: 100
              }
            }
          }
        },
        targetCollection: getId(publicationType)
      },
      { acl: user }
    );

    // console.log(require('util').inspect(updateAction, { depth: null }));
    assert(updateAction.result.eligibleWorkflow);
    assert(updateAction.result.objectSpecification);
    // check that objectSpecification has been flattened
    assert(Array.isArray(updateAction.result.objectSpecification['@graph']));
  });
});
