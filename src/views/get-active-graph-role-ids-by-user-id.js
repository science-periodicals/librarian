import uniq from 'lodash/uniq';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';

/**
 * Note: "active" here means that the graph from where the roles are hasn't
 * been published or rejected
 */
export default function getActiveGraphRoleIdsByUserId(userId, opts, callback) {
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
      url: '/activeGraphRoleIdsByUserId',
      qs: {
        reduce: false,
        include_docs: false,
        key: JSON.stringify(getId(userId))
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const roleIds = uniq(body.rows.map(row => row.value).filter(Boolean));

      return callback(null, roleIds);
    }
  );
}
