import createError from '@scipe/create-error';
import { getDocs } from '../low';

export default function getExpiredActiveRegisterActions(
  validityDurationMs,
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
  const { store, now = new Date().getTime() } = opts;

  this.view.get(
    {
      url: '/activeRegisterActionsByStartTime',
      qs: {
        reduce: false,
        include_docs: true,
        startkey: JSON.stringify(0),
        endkey: JSON.stringify(
          Math.max(now - Math.max(validityDurationMs, 0), 0)
        )
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const docs = getDocs(body);
      callback(null, docs);
    }
  );
}
