import assert from 'assert';
import registerUser from './utils/register-user';
import { Librarian } from '../src/';

describe('user / profile ACL', function() {
  this.timeout(40000);

  let user, profile, user2, librarian;
  before(async () => {
    librarian = new Librarian();
    user = await registerUser();
    user2 = await registerUser();
    profile = await librarian.get(user, { acl: false });
  });

  describe('read', () => {
    it('should have read access to a profile when logged out', async () => {
      const safeDoc = await librarian.checkReadAcl(profile, { acl: true });
      assert.deepEqual(safeDoc, profile);
    });
  });
});
