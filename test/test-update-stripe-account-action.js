import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('UpdateAction (stripe account)', function() {
  this.timeout(40000);

  let librarian, user, organization, accountId;
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

    const createPaymentAccountAction = await librarian.post(
      {
        '@type': 'CreatePaymentAccountAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization),
        result: {
          country: 'US'
        }
      },
      { acl: user }
    );

    accountId = getId(createPaymentAccountAction.result);
  });

  it('should update a stripe account', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: {
          business_name: 'Org inc'
        },
        targetCollection: accountId
      },
      { acl: user }
    );

    // console.log(require('util').inspect(updateAction, { depth: null }));

    assert.equal(updateAction.result.business_name, 'Org inc');
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
