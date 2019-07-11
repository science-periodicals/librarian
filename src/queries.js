import stringify from 'json-stable-stringify';
import crypto from 'crypto';

export function createCacheKey(prefix, query) {
  if (!query) {
    query = prefix;
    prefix = null;
  }

  const hash = crypto.createHash('sha1').update(stringify(query)).digest('hex');

  return prefix ? `${prefix}:${hash}` : hash;
}
