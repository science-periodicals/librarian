import createError from '@scipe/create-error';
import createId from '../create-id';

export default function changePassword(username, nextPassword, callback) {
  this.authDb.get(
    {
      url: `/${encodeURIComponent(createId('user', username)._id)}`,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const nextUser = Object.assign({}, body, { password: nextPassword });

      this.authDb.put(
        {
          url: `/${encodeURIComponent(nextUser._id)}`,
          json: nextUser
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return callback(err);
          }
          callback(null, body);
        }
      );
    }
  );
}
