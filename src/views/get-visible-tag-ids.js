import { arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getAgentId } from '../utils/schema-utils';

export default function getVisibleTagIds(role, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache = false } = opts;

  const agentId = getAgentId(role);
  if (!agentId) return callback(null, []);

  this.view.get(
    {
      url: '/visibleTagIds',
      qs: {
        key: JSON.stringify(agentId),
        reduce: false,
        include_docs: false
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const visibleTagIds = arrayify(body.rows)
        .map(row => row.value)
        .filter(Boolean);

      callback(null, visibleTagIds);
    }
  );
}
