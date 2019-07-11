import uniq from 'lodash/uniq';
import createError from '@scipe/create-error';
import { arrayify, dearrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * If `email` is a list, returns a list
 */
export default function getProfileByEmail(email, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  const keys = uniq(arrayify(email));

  const cacheKey = `view:profilesByEmail:${keys.join('-')}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.post(
    {
      url: '/profilesByEmail',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: { keys }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const profiles = getDocs(body);
      if (profiles.length > keys.length) {
        if (store) {
          store.add(profiles);
        }
        return callback(
          createError(500, `too many profiles for ${keys.join(', ')}`)
        );
      }

      if (store) {
        store.cache(cacheKey, profiles, { includeDocs: false });
      }
      callback(null, dearrayify(email, profiles));
    }
  );
}
