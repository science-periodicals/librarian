import createError from '@scipe/create-error';
import { arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getEncodingByContentUrl(contentUrl, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.view.get(
    {
      url: '/encodingsByContentUrl',
      qs: {
        key: JSON.stringify(contentUrl),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const doc = getDocs(body)[0];
      if (doc) {
        // assets
        for (const p of ['style', 'image', 'audio', 'video', 'logo']) {
          const encodings = arrayify(doc[p])
            .reduce((encodings, resource) => {
              return encodings.concat(arrayify(resource.encoding));
            }, [])
            .reduce((encodings, encoding) => {
              return encodings.concat(encoding, arrayify(encoding.thumbnail));
            }, []);

          const encoding = encodings.find(
            encoding => encoding.contentUrl === contentUrl
          );
          if (encoding) {
            return callback(null, encoding);
          }
        }

        // nodes
        const encoding = arrayify(doc['@graph']).find(
          node => node.contentUrl === contentUrl
        );
        if (encoding) {
          return callback(null, encoding);
        }
      }

      return callback(
        createError(404, `getEncodingByContentUrl: Not found (${contentUrl})`)
      );
    }
  );
}
