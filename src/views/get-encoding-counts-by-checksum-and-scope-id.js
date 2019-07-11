import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';

export default function getEncodingCountsByChecksumAndScopeId(
  checksum,
  scopeId, // can be a graphId
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

  this.view.get(
    {
      url: '/sha256',
      qs: {
        key: JSON.stringify([checksum, getScopeId(scopeId)]),
        reduce: true,
        include_docs: false
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let counts;
      try {
        counts = body.rows[0].value;
      } catch (err) {
        counts = 0;
      }
      callback(null, counts);
    }
  );
}
