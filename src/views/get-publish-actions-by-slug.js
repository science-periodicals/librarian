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

      callback(null, getDocs(body));
    }
  );
}
