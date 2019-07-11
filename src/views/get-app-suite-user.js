import { unprefix } from '@scipe/jsonld';
import { parseRoleIds } from '../utils/role-utils';

export default function getAppSuiteUser(role, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  const { userId } = parseRoleIds(role);

  this.getCouchDbRoles(role, opts, (err, roles) => {
    if (err) return callback(err);
    callback(null, {
      '@id': userId,
      username: unprefix(userId),
      roles
    });
  });
}
