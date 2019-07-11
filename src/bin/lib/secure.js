import async from 'async';
import request from 'request';
import { getBaseUrl, getAdminAuthHeaders } from '../../';
import createError from '@scipe/create-error';

/**
 * set CouchDB auth
 * see http://docs.couchdb.org/en/latest/intro/security.html
 */
export default function secure(dbs, config, callback) {
  async.each(
    dbs,
    (db, cb) => {
      request.put(
        {
          url: getBaseUrl(config) + db + '/_security',
          auth: getAdminAuthHeaders(config),
          json: {
            couchdb_auth_only: true,
            members: {
              names: [],
              roles: ['user', 'proxyUser', 'apiAdmin']
            },
            admins: {
              names: [],
              roles: ['admin']
            }
          }
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return cb(err);
          }
          cb(null);
        }
      );
    },
    callback
  );
}
