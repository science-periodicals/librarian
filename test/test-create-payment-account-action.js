import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

// TODO test with invalid / incomplete bank account

describe('CreatePaymentAccountAction', function() {
  this.timeout(40000);

  let librarian, user, organization, createPaymentAccountAction;
  before(async () => {
    librarian = new Librarian();
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

    createPaymentAccountAction = await librarian.post(
      {
        '@type': 'CreatePaymentAccountAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization),
        result: {
          country: 'US',
          external_account: {
            object: 'bank_account',
            country: 'US',
            currency: 'usd',
            // see https://stripe.com/docs/connect/testing#account-numbers
            routing_number: '110000000',
            account_number: '000123456789'
          }
        }
      },
      { acl: user }
    );
  });

  it('should have created a stripe account', () => {
    // console.log(
    //   require('util').inspect(createPaymentAccountAction, { depth: null })
    // );
    assert(getId(createPaymentAccountAction.result).startsWith('stripe:'));
  });

  it('should find the stripe account of a given organization', async () => {
    const account = await librarian.getStripeAccountByOrganizationId(
      getId(organization)
    );
    // console.log(require('util').inspect(account, { depth: null }));

    // we make sure that the account reference the organization as part of the account metdata
    assert.equal(getId(account.metadata.organization), getId(organization));
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
