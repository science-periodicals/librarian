import assert from 'assert';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('login / logout', function() {
  this.timeout(40000);

  let librarian, token;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    const user = await registerUser();
    token = await librarian.login(user);
  });

  it('should have acquired a valid token', () => {
    assert(token);
  });

  it('should be logged in on CouchDB', done => {
    librarian.checkCouchLogin((err, isLoggedInOnCouch) => {
      if (err) return done(err);
      assert.equal(isLoggedInOnCouch, true);
      done();
    });
  });

  it('should logout', done => {
    librarian.logout((err, headers, body) => {
      if (err) return done(err);
      librarian.checkCouchLogin((err, isLoggedInOnCouch) => {
        assert.equal(err.code, 401);
        done();
      });
    });
  });
});
