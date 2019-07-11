import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * See also `getActionsByObjectId`
 */
export default function getActionsByObjectIdAndType(
  objectId,
  type,
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
  const { store, fromCache = false } = opts;

  objectId = getId(objectId);

  const cacheKey = `view:actionByObjectIdAndType:${objectId}:${type}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/actionByObjectIdAndType',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify([objectId, type])
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let payload = getDocs(body);

      if (store) {
        // Because of CouchDB 2.0 clustering the view may be out of date and
        // miss some recent actions. We try to mitigate that here for workflow action as
        // some action handlers may have pre-fetched some actions already
        store.add(payload);
        payload = store.getAll().filter(doc => {
          if (doc._id) {
            const [, _type] = parseIndexableString(doc._id);
            if ((_type === 'action' || _type === 'workflow') && doc.object) {
              var object;
              if (doc.object['@type'] && /Role/.test(doc.object['@type'])) {
                object = doc.object.object;
              } else {
                object = doc.object;
              }
              if (object) {
                const _objectId = getId(object);
                if (
                  objectId === _objectId &&
                  (type === _type || type === doc['@type'])
                ) {
                  return true;
                }
              }
            }
          }
          return false;
        });

        store.cache(cacheKey, payload, { includeDocs: true });
      }

      callback(null, payload);
    }
  );
}
