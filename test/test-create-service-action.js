import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify, unrole } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('CreateServiceAction', function() {
  this.timeout(40000);

  describe('normal services', () => {
    let librarian = new Librarian({ skipPayments: true });
    let organization, user;

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
    });

    it('should create a typesetting Service', async () => {
      const createServiceAction = await librarian.post(
        {
          '@type': 'CreateServiceAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          object: getId(organization),
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
      // console.log(require('util').inspect(createServiceAction, { depth: null }));

      assert(getId(createServiceAction.result));

      // check that typesetting action (service output) has right audience
      const typesettingAction = createServiceAction.result.serviceOutput;
      assert.equal(
        createServiceAction.result.serviceOutput.agent['@type'],
        'ContributorRole'
      );

      assert(
        arrayify(typesettingAction.participant).some(
          participant =>
            unrole(participant, 'participant').audienceType === 'author'
        ) &&
          arrayify(typesettingAction.participant).some(
            participant =>
              unrole(participant, 'participant').audienceType === 'producer'
          )
      );
    });
  });

  describe('brokerable services', () => {
    let librarian = new Librarian({ skipPayments: true });
    let organization, user, brokeredService;

    before(async () => {
      user = await registerUser();
      const admin = await registerUser({ memberOf: 'acl:admin' });

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

      const createProviderOrganizationAction = await librarian.post(
        {
          '@type': 'CreateOrganizationAction',
          agent: getId(admin),
          actionStatus: 'CompletedActionStatus',
          result: {
            '@id': `org:${uuid.v4()}`,
            '@type': 'Organization'
          }
        },
        { acl: admin }
      );

      const providerOrganization = createProviderOrganizationAction.result;

      const createServiceAction = await librarian.post(
        {
          '@type': 'CreateServiceAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(admin),
          object: getId(providerOrganization),
          result: {
            '@type': 'Service',
            allowBroker: true,
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
        { acl: admin }
      );

      brokeredService = createServiceAction.result;
    });

    it('should create a brokered typesetting Service', async () => {
      const createServiceAction = await librarian.post(
        {
          '@type': 'CreateServiceAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          object: getId(organization),
          result: {
            '@type': 'Service',
            provider: getId(brokeredService.provider),
            broker: getId(organization),
            brokeredService: getId(brokeredService),
            serviceType: 'typesetting',
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
      // console.log(
      //   require('util').inspect(createServiceAction, { depth: null })
      // );

      assert.equal(
        createServiceAction.result.serviceOutput.agent['@type'],
        'ServiceProviderRole'
      );
    });
  });
});
