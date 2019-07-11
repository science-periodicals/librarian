import createError from '@scipe/create-error';
import request from 'request';
import { getBaseUrl } from '../low';

export default function session(callback) {
  if (!this.authHeaders) {
    return callback(createError(401, 'no authHeaders'));
  }
  request.get(
    {
      url: `${getBaseUrl(this.config)}_session`,
      headers: this.authHeaders,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      this.log.trace(
        {
          session: body,
          authHeaders: this.authHeaders,
          headers: resp && resp.headers
        },
        'librarian.session'
      );

      callback(null, body);
    }
  );
}
