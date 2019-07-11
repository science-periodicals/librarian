import createError from '@scipe/create-error';
import { getDbName } from '../low';

export default async function createLock(
  id = '',
  {
    isLocked, // a function returning a Boolean or a Promise of a Boolean (true if the id exists and false otherwise) or `null` if we only rely on redis
    prefix = '',
    ttl = 1000 * 60 * 2
  } = {}
) {
  const respErr = createError(423, `id locked (${prefix} ${id})`);

  try {
    var lock = await this.redlock.lock(
      `${getDbName(this.config)}:locks${prefix ? `:${prefix}` : ''}${id}`,
      ttl
    );
  } catch (err) {
    throw respErr;
  }

  if (isLocked) {
    try {
      const locked = await Promise.resolve(isLocked());
      if (!locked) {
        return lock;
      }
    } catch (err) {
      this.log.error({ err }, 'error calling isLocked()');
    }
  } else if (isLocked === null) {
    return lock;
  } else {
    try {
      await this.get(id, {
        acl: false
      });
    } catch (err) {
      if (err.code === 404) {
        return lock;
      }
    }
  }

  try {
    await lock.unlock();
  } catch (err) {
    this.log.error({ err }, 'could not release lock, but it will auto expire');
  }

  throw respErr;
}
