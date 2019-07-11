import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src/';

describe('ActivateAction', function() {
  this.timeout(40000);

  const librarian = new Librarian({ skipPayments: true });

  describe('WorkflowSpecification', () => {
    let user, periodical, organization, workflowSpecification;
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
                grantee: user['@id']
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
                '@type': 'Graph'
              }
            }
          }
        },
        { acl: user }
      );

      workflowSpecification = createWorkflowSpecificationAction.result;
    });

    it('should activate a WorkflowSpecification', async () => {
      const activateAction = await librarian.post(
        {
          '@type': 'ActivateAction',
          agent: user['@id'],
          actionStatus: 'CompletedActionStatus',
          object: getId(workflowSpecification)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(activateAction, { depth: null }));

      assert.equal(
        activateAction.result.workflowSpecificationStatus,
        'ActiveWorkflowSpecificationStatus'
      );
    });
  });

  describe('Service', () => {
    let organization, user, service;

    before(async () => {
      user = await registerUser();

      const createOrganizationAction = await librarian.post(
        {
          '@type': 'CreateOrganizationAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          result: {
            '@id': `org:${uuid.v4()}`,
            '@type': 'Organization'
          }
        },
        { acl: user }
      );

      organization = createOrganizationAction.result;

      const createServiceAction = await librarian.post(
        {
          '@type': 'CreateServiceAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          object: getId(organization),
          result: {
            '@type': 'Service',
            serviceStatus: 'DeactivatedServiceStatus',
            serviceType: 'typesetting',
            availableChannel: {
              '@type': 'ServiceChannel',
              processingTime: 'P1D'
            },
            offers: {
              '@type': 'Offer',
              priceSpecification: {
                '@type': 'PriceSpecification',
                price: 10,
                priceCurrency: 'USD',
                valueAddedTaxIncluded: false,
                platformFeesIncluded: false
              }
            }
          }
        },
        { acl: user }
      );

      service = createServiceAction.result;
    });

    it('should activate a Service', async () => {
      const activateAction = await librarian.post(
        {
          '@type': 'ActivateAction',
          agent: user['@id'],
          actionStatus: 'CompletedActionStatus',
          object: getId(service)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(activateAction, { depth: null }));
      assert.equal(activateAction.result.serviceStatus, 'ActiveServiceStatus');
    });
  });

  after(done => {
    librarian.close(done);
  });
});
