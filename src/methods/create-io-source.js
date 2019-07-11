import BlobStore from '@scipe/blob-store';
import Redlock from 'redlock';
import {
  createDb,
  createAuthDb,
  createRedisClient,
  createEmailClient,
  getDbName
} from '../low';
import { TokenStore } from '../tokens';

export default function createIoSource(ioSourceName, cache) {
  if (!this.config) {
    throw new Error('this.config is undefined');
  }

  if (this.config[ioSourceName]) {
    return this.config[ioSourceName];
  }

  if (cache && cache[ioSourceName]) {
    return cache[ioSourceName];
  }

  let ioSource;
  switch (ioSourceName) {
    case 'email':
      ioSource = createEmailClient(this.config);
      break;

    case 'blobStore':
      ioSource = new BlobStore(this.config);
      break;

    case 'redis':
      ioSource = createRedisClient(this.config);
      this.ownRedis = true;
      break;

    case 'redlock': {
      const redis = this.redis || this.createIoSource('redis', cache);
      ioSource = new Redlock([redis], {
        retryCount: 0 // retryCount=0 => we treat a failure as the resource being "locked" or (more correctly) "unavailable"
      });

      // See https://github.com/mike-marcacci/node-redlock
      // Redlock is designed for high availability, it does not care if a
      // minority of redis instances/clusters fail at an operation
      // we report those error here to help debugging
      ioSource.on('clientError', err => {
        this.log.error(
          { warn: err },
          `A redis error has occurred while using Redlock`
        );
      });
      break;
    }

    case 'db':
      // Note we use `{admin: true}` instead of `this.authHeaders ? { authHeaders: this.authHeaders } : { admin: true }` so that we don't need to recreate the DB after logout
      ioSource = createDb(this.config, { admin: true });
      break;

    case 'search':
    case 'view':
      // Note we use `{admin: true}` instead of `this.authHeaders ? { authHeaders: this.authHeaders } : { admin: true }` so that we don't need to recreate the DB after logout
      ioSource = createDb(
        this.config,
        Object.assign(
          { ddoc: 'scienceai', [ioSourceName]: true },
          { admin: true }
        )
      );
      break;

    case 'authDb':
      ioSource = createAuthDb(this.config);
      break;

    case 'authDbView':
      ioSource = createAuthDb(this.config, { ddoc: 'auth', view: true });
      break;

    case 'tokenStore': {
      const redis = this.redis || this.createIoSource('redis', cache);
      ioSource = new TokenStore(redis, `${getDbName(this.config)}:tokens`);
      break;
    }

    default:
      throw new Error('unsuported io source');
  }
  if (cache) {
    cache[ioSourceName] = ioSource;
  }
  return ioSource;
}
