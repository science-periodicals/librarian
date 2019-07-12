import createError from '@scipe/create-error';
import { getDocs } from '../low';

export default function getPublishActionsBySlug(slug, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  this.view.get(
    {
      url: '/publishActionBySlugs',
      qs: {
        key: JSON.stringify(slug),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let payload = getDocs(body);

      // Because of CouchDB 2.0 clustering the view may be out of date and
      // miss some recent actions. We try to mitigate that here by recomputing
      // the view from data from the store
      if (store) {
        // add current payload to store first
        store.add(payload);
        // reconstruct the payload from the store that may have more data
        payload = store.getAll().filter(doc => {
          return (
            doc['@type'] === 'PublishAction' &&
            doc.result &&
            doc.result.slug === slug
          );
        });
      }

      callback(null, payload);
    }
  );
}
