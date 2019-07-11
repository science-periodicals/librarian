import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { toIndexableString } from '@scipe/collate';
import { getDocs } from '../low';

export default function getServicesByBrokerId(brokerId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  brokerId = getId(brokerId);

  const cacheKey = `view:_all_docs:service:${brokerId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/_all_docs',
      qs: {
        reduce: false,
        include_docs: true,
        startkey: JSON.stringify(toIndexableString([brokerId, 'service', ''])),
        endkey: JSON.stringify(
          toIndexableString([brokerId, 'service', '\ufff0'])
        )
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const services = getDocs(body);

      if (store) {
        store.cache(cacheKey, services, { includeDocs: true });
      }

      return callback(null, services);
    }
  );
}
