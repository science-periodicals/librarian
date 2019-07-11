import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getActionsByResultId(resultId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  resultId = getId(resultId);

  const cacheKey = `view:actionsByResultId:${resultId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/actionsByResultId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify(resultId)
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const payload = getDocs(body);

      if (store) {
        store.cache(cacheKey, payload, { includeDocs: true });
      }

      callback(null, payload);
    }
  );
}
