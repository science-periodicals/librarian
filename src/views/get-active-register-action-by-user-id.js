import createError from '@scipe/create-error';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getActiveRegisterActionByUserId(
  userId, // can be a list
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
  const { store } = opts;

  const keys = arrayify(userId).map(getId);

  this.view.post(
    {
      url: '/activeRegisterActionsByAgent',
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

      const actions = getDocs(body);
      if (keys.length === 1 && !actions.length) {
        return callback(createError(404, 'Not found'));
      }
      if (actions.length > keys.length) {
        this.log.fatal(
          { err, userId },
          `More than ${
            keys.length
          } action found in getActiveRegisterActionByUserId`
        );
        return callback(
          createError(
            500,
            `More than ${
              keys.length
            } action found in getActiveRegisterActionByUserId`
          )
        );
      }

      callback(null, dearrayify(userId, actions));
    }
  );
}
