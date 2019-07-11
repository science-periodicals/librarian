import createError from '@scipe/create-error';
import { parseIndexableString } from '@scipe/collate';
import { getId } from '@scipe/jsonld';
import { hasPublicAudience } from '../acl';
import { getRootPartId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import Store from '../utils/store';

/**
 * Check if `object` is public
 * Note we assume that `object` is trustworthy
 */
export default async function checkPublicAvailability(
  object,
  { store = new Store(), now } = {}
) {
  let type;
  if (object._id) {
    [, type] = parseIndexableString(object._id);
  } else {
    try {
      object = await this.get(object, { store, acl: false });
    } catch (err) {
      if (err.code !== 404) {
        throw err;
      }
    }
    if (object._id) {
      [, type] = parseIndexableString(object._id);
    } else if (!object._id && getId(object)) {
      [type] = getId(object).split(':');
    }
  }

  switch (type) {
    case 'user':
    case 'profile':
    case 'org':
    case 'service':
      return true;

    case 'journal':
      return hasPublicAudience(object, { now });

    case 'action': {
      const scopeId = getScopeId(object);
      // for graph action, we need to check if the graph journal is also public
      if (scopeId && scopeId.startsWith('graph:')) {
        if (hasPublicAudience(object, { now })) {
          return this.checkPublicAvailability(scopeId, { store, now });
        }
      }
      return hasPublicAudience(object, { now });
    }

    case 'workflow':
    case 'issue': {
      const scopeId = getScopeId(object);
      if (!scopeId || !scopeId.startsWith('journal:')) {
        return false;
      }
      return this.checkPublicAvailability(getScopeId(object), { store, now });
    }

    case 'contact':
    case 'audience':
    case 'arole':
    case 'role':
    case 'srole':
    case 'node':
    case 'cnode': {
      const embedderId = getId(object.isNodeOf);
      if (!embedderId) {
        return false;
      }

      return this.checkPublicAvailability(embedderId, { store, now });
    }

    case 'release':
    case 'graph': {
      // check that journal is also public

      if (hasPublicAudience(object, { now })) {
        const journalId = getRootPartId(object);

        if (!journalId || !journalId.startsWith('journal:')) {
          return true;
        }

        let journal;
        try {
          journal = await this.get(journalId, { acl: false, store });
        } catch (err) {
          if (err.code === 404) {
            throw createError(
              404,
              `checkPublicAvailability could not get ${journalId} (from ${getId(
                object
              )})`
            );
          }
          throw err;
        }
        return hasPublicAudience(journal, { now });
      }

      return false;
    }

    default:
      return false;
  }
}
