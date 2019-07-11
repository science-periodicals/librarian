import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('UpdateAction (stripe customer)', function() {
  this.timeout(40000);

  let librarian, user, organization, customerId;
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

    const createCustomerAccountAction = await librarian.post(
      {
        '@type': 'CreateCustomerAccountAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization)
      },
      { acl: user }
    );

    customerId = getId(createCustomerAccountAction.result);
  });

  it('should update the customer payment method', async () => {
    // Add a card to a new account
    let updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: {
          source: 'tok_visa'
        },
        targetCollection: customerId
      },
      { acl: user }
    );

    // console.log(require('util').inspect(updateAction, { depth: null }));

    assert.equal(updateAction.result.sources.data[0].brand, 'Visa');

    // Change card
    updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: {
          source: 'tok_mastercard'
        },
        targetCollection: customerId
      },
      { acl: user }
    );
    assert.equal(updateAction.result.sources.data[0].brand, 'MasterCard');
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
