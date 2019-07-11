import createError from '@scipe/create-error';
import { getDocs } from '../low';

export default function getActiveRegisterActionsByEmail(email, opts, callback) {
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
      url: 'activeRegisterActionsByAgent',
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
