import createError from '@scipe/create-error';
import request from 'request';
import { getBaseUrl } from '../low';

export default function logout(callback) {
  this.log.trace({ headers: this.authHeaders }, 'loggin out');
  if (!this.authHeaders) {
    return callback(null);
  }

  request.del(
    {
      url: `${getBaseUrl(this.config)}_session`,
      headers: this.authHeaders,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      delete this.authHeaders;
      delete this.username;
      delete this.userId;
      this.log.trace({ body }, 'logged out');
      // !! the caller will have to clear the AuthSession cookie (potentially using the Set-Cookie info in header) (see logout in scienceai/api for an example)
      callback(null, resp.headers, body);
    }
  );
}
