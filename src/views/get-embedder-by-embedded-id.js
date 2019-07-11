import createError from '@scipe/create-error';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';

export default function getEmbedderByEmbeddedId(
  embeddedId, // can be a list in this case result are returned in same order as input
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
  const { fromCache = false, store } = opts;

  const embeddedIds = arrayify(embeddedId);
  const keys = embeddedIds.map(getId).filter(Boolean);

  if (keys.length !== embeddedIds.length) {
    throw createError(
      400,
      'getEmbedderByEmbeddedId invalid embeddedId parameter'
    );
  }

  const cacheKey = `view:byEmbeddedId:${keys.join(':')}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.post(
    {
      url: '/byEmbeddedId',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: {
        keys
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const rows = arrayify(body.rows);
      const resMap = rows.reduce((map, row) => {
        if (row.key && row.doc) {
          map[row.key] = row.doc;
        }
        return map;
      }, {});

      const missing = keys.filter(key => !(key in resMap));
      if (missing.length) {
        return callback(
          createError(
            404,
            `getEmbedderByEmbeddedId no embedder found for: ${missing.join(
              ' ; '
            )}`
          )
        );
      }

      const duplicate = keys.filter(key => {
        return (
          new Set(rows.filter(row => row.key === key).map(row => row.id)).size >
          1
        );
      });
      if (duplicate.length) {
        return callback(
          createError(
            500,
            `getEmbedderByEmbeddedId multiple embedding for: ${duplicate.join(
              ' ; '
            )}`
          )
        );
      }

      const payload = dearrayify(embeddedId, keys.map(key => resMap[key]));

      if (store) {
        store.cache(cacheKey, payload, { includeDocs: true });
      }

      callback(null, payload);
    }
  );
}
