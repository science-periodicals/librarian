import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';

export class TokenStore {
  constructor(redis, prefix) {
    this.redis = redis;
    this.prefix = prefix;
  }

  /**
   * Note token key is getId(token.instrumentOf || token) so that we can find
   * token by instrument @id when relevant. Main use case of that is creating an
   * activation link in registration emails (see inform action handler)
   */
  getKey(token) {
    return typeof token === 'string'
      ? token
      : getId((token && token.instrumentOf) || token);
  }

  set(token, callback) {
    token = Object.assign({ '@type': 'Token' }, token);

    const key = this.getKey(token);
    if (!key) {
      return callback(
        createError(400, `invalid parameter, could not derive token key`)
      );
    }

    this.redis.set(
      `${this.prefix}:${key}`,
      JSON.stringify(token),
      (err, res) => {
        callback(err);
      }
    );
  }

  setex(
    token,
    ex = 3 * 24 * 60 * 60, // 3 days (ex is in seconds)
    callback
  ) {
    token = Object.assign({ '@type': 'Token' }, token);

    const key = this.getKey(token);
    if (!key) {
      return callback(
        createError(400, `invalid parameter, could not derive token key`)
      );
    }

    this.redis.setex(
      `${this.prefix}:${key}`,
      ex,
      JSON.stringify(token),
      (err, res) => {
        callback(err);
      }
    );
  }

  get(
    token, // either a token (object) or the `key` as a string
    callback
  ) {
    const key = this.getKey(token);
    if (!key) {
      return callback(
        createError(400, `invalid parameter, could not derive token key`)
      );
    }

    this.redis.get(`${this.prefix}:${key}`, (err, res) => {
      if (err) return callback(err);

      try {
        callback(null, JSON.parse(res));
      } catch (err) {
        callback(err);
      }
    });
  }

  remove(
    token, // either a token (object) or the `key` as a string
    callback
  ) {
    const key = this.getKey(token);

    if (!key) {
      return callback(
        createError(400, `invalid parameter, could not derive token key`)
      );
    }

    this.redis.del(`${this.prefix}:${key}`, (err, res) => {
      callback(err);
    });
  }
}
