import createError from '@scipe/create-error';
import { unprefix, getId } from '@scipe/jsonld';
import cookie from 'cookie';
import request from 'request';
import { getBaseUrl } from '../low';
import createId from '../create-id';
import { getAgent } from '../utils/schema-utils';

export default function login(agent, callback) {
  const user = getAgent(agent);
  const username = unprefix(getId(user));

  // We check if a profile exists
  // We take into account case where the agent is a proxied user as proxied user don't have profiles
  const splittedUserId = getId(user).split('~');
  const profileId = splittedUserId
    .slice(0, Math.max(1, splittedUserId.length - 1))
    .join('~');

  this.head(createId('profile', profileId), (err, rev) => {
    if (err) {
      return callback(
        err.code === 404
          ? createError(401, 'invalid credentials (or inactive account)')
          : createError(
              500,
              `could not head profile (${err.message || 'no message'})`
            )
      );
    }

    request.post(
      {
        url: `${getBaseUrl(this.config)}_session`,
        form: { name: username, password: user.password },
        header: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          this.log.trace({ err }, 'couchdb loggin error');
          return callback(err);
        }
        this.log.trace({ username, body }, 'couchdb loggin');

        try {
          const authSessionCookie = resp.headers['set-cookie']
            .map(value => cookie.parse(value))
            .find(value => value['AuthSession']);

          var token = authSessionCookie['AuthSession'];
        } catch (e) {
          return callback(createError(500, e));
        }

        if (!token) {
          return callback(
            createError(500, 'could not get an AuthSession cookie')
          );
        }

        // TODO call check couch login here and error upstream
        this.username = username;
        this.userId = getId(user);
        this.authHeaders = {
          'X-CouchDB-WWW-Authenticate': 'Cookie',
          Cookie: cookie.serialize('AuthSession', token)
        };
        this.log.trace(
          { username, authHeaders: this.authHeaders, token },
          'logged in'
        );
        return callback(null, token, this.authHeaders);
      }
    );
  });
}
