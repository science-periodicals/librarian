import { arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import { getDocs } from '../low';

export default function getActionsByScopeIdAndTypes(
  scopeId,
  types,
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  scopeId = getScopeId(scopeId);

  const { store, fromCache = false } = opts;

  const cacheKey = `view:actionsByScopeIdAndType:${scopeId}:${arrayify(
    types
  ).join(':')}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.post(
    {
      url: '/actionsByScopeIdAndType',
      json: {
        keys: arrayify(types).map(type => [scopeId, type])
      },
      qs: {
        reduce: false,
        include_docs: true
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let payload = getDocs(body);

      // Because of CouchDB 2.0 clustering the view may be out of date and
      // miss some recent actions. We try to mitigate that here for workflow action as the
      // action handler could only complete if it was able to fetch
      // the data that this view would return => the data should all be
      // in the `store`

      if (store) {
        // add current payload to store first
        store.add(payload);
        // reconstruct the payload from the store that may have more data
        payload = store
          .getAll()
          .filter(
            doc =>
              getScopeId(doc) === scopeId &&
              arrayify(types).some(type => type === doc['@type'])
          );

        store.cache(cacheKey, payload, { includeDocs: true });
      }

      callback(null, payload);
    }
  );
}
