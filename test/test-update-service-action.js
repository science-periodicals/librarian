import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src/';

describe('Update service', function() {
  this.timeout(40000);

  let librarian, user, organization, service;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': `org:${uuid.v4()}`,
          '@type': 'Organization',
          name: 'my org'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    const createServiceAction = await librarian.post(
      {
        '@type': 'CreateServiceAction',
        agent: getId(user),
        object: getId(organization),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@type': 'Service',
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

  it('should update a Service', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        ifMatch: service._rev,
        object: {
          name: 'updated name'
        },
        targetCollection: getId(service)
      },
      { acl: user }
    );

    // console.log(require('util').inspect(updateAction, { depth: null }));
    assert.equal(updateAction.result.name, 'updated name');
  });
});
