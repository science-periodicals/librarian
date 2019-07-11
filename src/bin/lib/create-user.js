import { createAuthDb, createId } from '../../';
import createError from '@scipe/create-error';

export default function({ username, password, role }, config, callback) {
  const data = {
    name: username,
    type: 'user',
    password: password,
    roles: [role]
  };

  const db = createAuthDb(config);

  db.put(
    {
      url: `/${createId('user', data.name)._id}`,
      json: data
    },
    function(err, resp, body) {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      callback(null, body);
    }
  );
}
