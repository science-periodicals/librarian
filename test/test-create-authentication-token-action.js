import assert from 'assert';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('CreateAuthenticationTokenAction', function() {
  this.timeout(40000);

  let admin, user, createAuthenticationTokenAction;
  const librarian = new Librarian({ skipPayments: true });

  before(async () => {
    [admin, user] = await Promise.all([
      registerUser({
        memberOf: 'acl:admin'
      }),
      registerUser()
    ]);

    createAuthenticationTokenAction = await librarian.post(
      {
        '@type': 'CreateAuthenticationTokenAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(admin),
        object: getId(user)
      },
      { acl: admin }
    );
  });

  it('should have created an authentication token and a proxy user', () => {
    // console.log(
    //   require('util').inspect(createAuthenticationTokenAction, { depth: null })
    // );
    const token = createAuthenticationTokenAction.result;
    assert(token.value);
  });

  it('should get the proxy user', async () => {
    const token = createAuthenticationTokenAction.result;
    const proxyUser = await librarian.getProxyUserByAuthenticationToken(token);

    assert.equal(proxyUser['@id'], `${user['@id']}~${token.value}`);
  });
});
