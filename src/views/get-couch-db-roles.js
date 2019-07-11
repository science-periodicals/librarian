import createError from '@scipe/create-error';
import { arrayify } from '@scipe/jsonld';
import createId from '../create-id';
import { parseRoleIds } from '../utils/role-utils';

export default function getCouchDbRoles(role, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache } = opts;

  const { userId } = parseRoleIds(role);

  if (!userId) {
    return callback(
      createError(
        400,
        'getCouchDbRole: invalid value for role parameter, could no get a userId'
      )
    );
  }

  const cacheKey = `view:auth-db:roles:${userId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.authDb.get(
    {
      url: `/${createId('user', userId)._id}`,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        if (err.code === 404) {
          return callback(createError(404, `No user found for ${userId}`));
        }
        return callback(err);
      }
      const roles = arrayify(body.roles);

      if (store) {
        store.cache(cacheKey, roles, { includeDocs: false });
      }

      callback(null, roles);
    }
  );
}
