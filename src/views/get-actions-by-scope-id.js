import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getDocs } from '../low';
import getScopeId from '../utils/get-scope-id';

export default function getActionsByScopeId(object, opts, callback) {
  const scopeId = getScopeId(object);

  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache = false } = opts;

  const cacheKey = `view:actionsByScopeId:${scopeId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/actionsByScopeId',
      qs: Object.assign({
        reduce: false,
        include_docs: true,
        key: `"${scopeId}"`
      }),
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let payload = getDocs(body);

      if (store) {
        // Because of CouchDB 2.0 clustering the view may be out of date and
        // miss some recent actions. We try to mitigate that here by using the
        // store

        store.add(payload);

        payload = store.getAll().filter(doc => {
          return (
            doc._id &&
            parseIndexableString(doc._id)[1] === 'action' &&
            getScopeId(doc) === scopeId
          );
        });

        store.cache(cacheKey, payload, { includeDocs: true });
      }

      callback(null, payload);
    }
  );
}
