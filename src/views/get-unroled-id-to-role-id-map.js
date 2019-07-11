import createError from '@scipe/create-error';
import { toIndexableString, parseIndexableString } from '@scipe/collate';
import { getId, arrayify, getNodeMap, textify } from '@scipe/jsonld';
import { getDocs } from '../low';
import getScopeId from '../utils/get-scope-id';
import { getParts } from '../utils/schema-utils';
import { parseRoleIds } from '../utils/role-utils';

/**
 * This is used in document-worker to ensure that role @id of the main entity
 * (and its parts) are properly recycled accross document transformation
 * This is required as JoinAction or CheckAction target those roles so they need
 * to persist accross revisions
 */
export default function getUnroledIdToRoleIdMap(scopeId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  scopeId = getScopeId(scopeId);

  this.get(scopeId, { acl: false, store }, (err, graph) => {
    if (err) {
      return callback(err);
    }

    this.db.get(
      {
        url: '/_all_docs',
        qs: {
          startkey: JSON.stringify(toIndexableString([scopeId, 'release', ''])),
          endkey: JSON.stringify(
            toIndexableString([scopeId, 'release', '\ufff0'])
          ),
          include_docs: true
        },
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return callback(err);
        }

        let docs = getDocs(body);

        if (store) {
          store.add(docs);
          // regenerate from store in case store has more data (CouchDB 2.x eventual consistency all of that)
          docs = store.getAll().filter(doc => {
            const [scopeId, type] = parseIndexableString(doc._id);
            return type === 'release' && scopeId === scopeId;
          });
        }

        const userToRoleIdMap = docs.concat(graph).reduce((map, graph) => {
          if (getId(graph.mainEntity)) {
            const nodeMap = getNodeMap(graph);
            const root = nodeMap[getId(graph.mainEntity)];
            if (root) {
              const parts = [root].concat(getParts(root, nodeMap));
              parts.forEach(part => {
                ['author', 'contributor'].forEach(p => {
                  arrayify(part[p]).forEach(roleId => {
                    const role = nodeMap[getId(roleId)];
                    if (role) {
                      const { roleId, userId } = parseRoleIds(role);
                      if (roleId && userId) {
                        if (!map[userId]) {
                          map[userId] = {};
                        }
                        if (getId(part) === getId(graph.mainEntity)) {
                          map[userId].__mainEntity__ = roleId;
                        } else if (part.alternateName) {
                          map[userId][textify(part.alternateName)] = roleId;
                        }
                      }
                    }
                  });
                });
              });
            }
          }

          return map;
        }, {});

        callback(null, userToRoleIdMap);
      }
    );
  });
}
