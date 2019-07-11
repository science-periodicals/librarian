import assert from 'assert';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian } from '../src/';

describe('getAppSuiteUser', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser({
      '@id': `user:${uuid.v4()}`,
      email: `${uuid.v4()}@science.ai`,
      password: uuid.v4(),
      memberOf: 'acl:readOnlyUser'
    });
  });

  it('should get app suite user data', done => {
    librarian.getAppSuiteUser(user, (err, data) => {
      if (err) return done(err);
      // console.log(require('util').inspect(data, { depth: null }));

      assert(data['@id']);
      assert(data.username);
      assert(data.roles.includes('readOnlyUser'));
      done();
    });
  });
});
