import createError from '@scipe/create-error';
import { getDocs } from '../low';

// TODO ? use getProfileByEmail instead (generalized to take a list as input)
export default function getProfilesByEmail(email, opts, callback) {
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
      url: '/profilesByEmail',
      qs: {
        key: JSON.stringify(email),
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
