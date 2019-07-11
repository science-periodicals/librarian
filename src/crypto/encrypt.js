import crypto from 'crypto';

export function encrypt(
  text,
  secret = {}, // `key` and `iv` or an `EncryptionKey`
  algorithm = 'aes-256-ctr'
) {
  const key = secret.key || Buffer.from(secret.value, 'hex');
  const iv = secret.iv || Buffer.from(secret.initializationVector, 'hex');

  var cipher = crypto.createCipheriv(algorithm, key, iv);
  var crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');

  return crypted;
}

export function decrypt(
  text,
  secret = {}, // `key` and `iv` or an `EncryptionKey`
  algorithm = 'aes-256-ctr'
) {
  const key = secret.key || Buffer.from(secret.value, 'hex');
  const iv = secret.iv || Buffer.from(secret.initializationVector, 'hex');

  var decipher = crypto.createDecipheriv(algorithm, key, iv);
  var dec = decipher.update(text, 'hex', 'utf8');
  dec += decipher.final('utf8');

  return dec;
}
