import { createAuthDb, createId } from '../../';
import { arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';

export default function addRole({ username, role }, config, callback) {
  const db = createAuthDb(config);
  if (!role) return callback(null, null);

  db.get(
    {
      url: `/${createId('user', username)._id}`,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      if (arrayify(body.roles).includes(role)) {
        return callback(null, body);
      }

      const nextUser = Object.assign(body, {
        roles: arrayify(body.roles).concat(role)
      });

      db.put(
        {
          url: `/${createId('user', username)._id}`,
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
