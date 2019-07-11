import assert from 'assert';
import { validateDigitalDocumentPermission } from '../src';

describe('validators', function() {
  describe('validateDigitalDocumentPermission', function() {
    it('should throw if a permission is invalid', () => {
      const invalid = {
        grantee: {
          '@type': 'Audience',
          audienceType: 'invalid'
        },
        permissionType: 'ReadPermission',
        permissionScope: {
          '@type': 'Audience',
          audienceType: 'public'
        }
      };

      assert.throws(() => {
        validateDigitalDocumentPermission(invalid);
      }, Error);
    });
  });
});
