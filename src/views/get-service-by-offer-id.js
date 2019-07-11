import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getServiceByOfferId(offerId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { fromCache = false, store } = opts;

  offerId = getId(offerId);

  const cacheKey = `view:serviceByOfferId:${offerId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/serviceByOfferId',
      qs: {
        key: JSON.stringify(offerId),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const docs = getDocs(body);
      if (docs.length > 1) {
        if (store) {
          store.add(docs);
        }
        return callback(
          createError(500, `Multiple service for offer ${offerId}`)
        );
      }

      const service = docs[0];
      if (!service) {
        return callback(
          createError(404, `Could not find Service for offer ${offerId}`)
        );
      }

      if (store) {
        store.cache(cacheKey, service, { includeDocs: true });
      }

      callback(null, service);
    }
  );
}
