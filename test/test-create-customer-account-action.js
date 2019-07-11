import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('CreateCustomerAccountAction', function() {
  this.timeout(40000);

  let librarian, user, organization, createCustomerAccountAction;
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
          '@type': 'Organization'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    createCustomerAccountAction = await librarian.post(
      {
        '@type': 'CreateCustomerAccountAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization)
      },
      { acl: user }
    );
  });

  it('should have created a stripe account', () => {
    //    console.log(
    //      require('util').inspect(createCustomerAccountAction, { depth: null })
    //    );
    assert(getId(createCustomerAccountAction.result).startsWith('stripe:'));
  });

  it('should find the stripe customer of a given organization', async () => {
    const customer = await librarian.getStripeCustomerByOrganizationId(
      getId(organization)
    );
    // console.log(require('util').inspect(customer, { depth: null }));

    // we make sure that the account reference the organization as part of the account metdata
    assert.equal(getId(customer.metadata.organization), getId(organization));
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
