import assert from 'assert';
import crypto from 'crypto';
import { encrypt, decrypt } from '../src';

describe('encrypt / decrypt', function() {
  this.timeout(4000);

  const key = {
    '@type': 'EncryptionKey',
    value: crypto.randomBytes(32).toString('hex'),
    initializationVector: crypto.randomBytes(16).toString('hex')
  };

  it('should encrypt and decrypt', () => {
    const txt = 'tiffany';
    const encrypted = encrypt(txt, key);
    assert(encrypted !== txt);
    assert.equal(decrypt(encrypted, key), txt);
  });
});
