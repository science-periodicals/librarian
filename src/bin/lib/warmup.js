import createError from '@scipe/create-error';
import ddoc from '@scipe/ddoc';
import asyncEachLimit from 'async/eachLimit';
import { createDb, getDbName } from '../../';

/* eslint-disable no-console */

export default function warmup(config, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  const { verbose = false } = opts || {};

  const view = createDb(
    config,
    Object.assign({ ddoc: 'scienceai', view: true }, { admin: true })
  );

  asyncEachLimit(
    Object.keys(ddoc.views),
    1,
    (key, cb) => {
      if (verbose) {
        console.log(`warming up ${getDbName(config)} view ${key}:`);
      }
      view.get(
        {
          url: `/${key}`,
          json: true
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return cb(err);
          }

          const stats =
            ddoc.views[key].reduce === '_count'
              ? `counts: ${body.rows[0] ? body.rows[0].value : 0}`
              : 'no counts / custom reduce';

          if (verbose) {
            console.log(`  -> ${resp.statusCode} (${stats})`);
          }

          cb(null);
        }
      );
    },
    err => {
      if (err) {
        return callback(err);
      }

      const search = createDb(
        config,
        Object.assign({ ddoc: 'scienceai', search: true }, { admin: true })
      );

      asyncEachLimit(
        Object.keys(ddoc.indexes),
        1,
        (key, cb) => {
          if (verbose) {
            console.log(`warming up ${getDbName(config)} index ${key}:`);
          }
          search.get(
            {
              url: `/${key}`,
              json: true,
              qs: { q: '*:*' }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return cb(err);
              }

              if (verbose) {
                console.log(
                  `  -> ${resp.statusCode} (total rows:  ${body.total_rows})`
                );
              }
              cb(null);
            }
          );
        },
        callback
      );
    }
  );
}
