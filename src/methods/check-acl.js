import asyncParallel from 'async/parallel';
import asyncMapSeries from 'async/mapSeries';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { arrayify, getId, unrole, unprefix } from '@scipe/jsonld';
import { getAgent, getAgentId, getRootPartId } from '../utils/schema-utils';
import { createCheckAcl } from '../acl';
import createId from '../create-id';
import { getDocs } from '../low';
import Store from '../utils/store';

export default function checkAcl(opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }

  let {
    acl,
    store = new Store(),
    agent,
    docs,
    checkActiveInviteActions = true
  } = opts || {};

  if (String(acl) === 'false') {
    return callback(null, null);
  }

  // opts.acl can be used to specify an agent
  if (
    acl &&
    !agent &&
    (typeof acl === 'object' ||
      (typeof acl === 'string' &&
        (acl.startsWith('user:') || acl.startsWith('role:'))))
  ) {
    agent = acl;
  }
  if (!agent) {
    agent = this.userId;
  }

  docs = arrayify(docs).filter(Boolean);

  const userId = getAgentId(agent);
  if (!userId || !userId.startsWith('user:')) {
    return callback(
      createError(
        401,
        `No user for checkAcl ${
          docs
            ? `(called with docs: ${Array.from(
                new Set(docs.map(doc => doc['@type']).filter(Boolean))
              )})`
            : ''
        }`
      )
    );
  }
  const user = getAgent(agent);

  asyncParallel(
    {
      roles: cb => {
        this.getCouchDbRoles(userId, { store }, cb);
      },

      // TODO uncomment when we need to check if a user belongs to an org
      //userOrganizationIds: cb => {
      //  this.getUserOrganizations(userId, { fromPeriodicalData: true }, cb);
      //},

      activeInviteActions: cb => {
        if (!checkActiveInviteActions) {
          return cb(null);
        }
        this.getActiveInviteActionByRecipientIdOrEmail(userId, { store }, cb);
      },

      scopes: cb => {
        if (!docs.length) {
          return cb(null, docs);
        }

        let _ids = new Set();
        let ids = new Set();
        let stripeIds = new Set();

        docs.forEach(doc => {
          if (doc) {
            if (doc._id) {
              _ids.add(doc._id);
            }

            if (typeof doc === 'string') {
              let parsed_id, type;
              try {
                parsed_id = parseIndexableString(doc);
                type = parsed_id[1];
              } catch (e) {}

              if (
                type === 'journal' ||
                type === 'workflow' ||
                type === 'graph' ||
                type === 'release' ||
                type === 'action' ||
                type === 'type' ||
                type === 'review' ||
                type === 'issue'
              ) {
                _ids.add(doc);
              } else {
                if (doc.startsWith('stripe:')) {
                  stripeIds.add(doc);
                } else {
                  ids.add(doc);
                }
              }
            } else {
              // doc is an object
              const id = getId(doc);
              if (id) {
                ids.add(id);
              }

              // We need to get to the scope
              // we collect any @id whose _id will have scope data (eg. issue: , service: etc.)
              // => we also collect the embedded @id (role: node: etc.) so that we get access to the embedder
              [
                // embedded
                'isNodeOf',
                // actions
                'object',
                'targetCollection',
                'recipient',
                'instrument',
                'instrumentOf',
                // Event
                'recordedInId',
                'workFeatured',
                // graph, journal
                'publisher'
              ].forEach(p => {
                if (doc[p]) {
                  const docIds = new Set();
                  const id = getId(doc[p]);
                  if (id) {
                    docIds.add(id);
                  }

                  if (doc[p].isNodeOf) {
                    const isNodeOfId = getId(doc[p].isNodeOf);
                    if (isNodeOfId) {
                      docIds.add(isNodeOfId);
                    }
                  }

                  const unroled = unrole(doc[p], p);
                  if (unroled) {
                    const unroledId = getId(unroled);
                    if (unroledId) {
                      docIds.add(unroledId);
                    }

                    if (unroled.isNodeOf) {
                      const isNodeOfId = getId(unroled.isNodeOf);
                      if (isNodeOfId) {
                        docIds.add(isNodeOfId);
                      }
                    }
                  }

                  Array.from(docIds).forEach(id => {
                    if (id.startsWith('stripe:')) {
                      stripeIds.add(id);
                    } else if (
                      //scope
                      id.startsWith('org:') ||
                      id.startsWith('journal:') ||
                      id.startsWith('graph:') ||
                      id.startsWith('service:') ||
                      id.startsWith('issue:') ||
                      id.startsWith('action:') ||
                      id.startsWith('type:') ||
                      id.startsWith('workflow:') ||
                      // embedded
                      id.startsWith('node:') ||
                      id.startsWith('cnode:') ||
                      id.startsWith('role:') ||
                      id.startsWith('srole:') ||
                      id.startsWith('arole:') ||
                      id.startsWith('audience:') ||
                      id.startsWith('token:') ||
                      id.startsWith('stripe:') ||
                      id.startsWith('tag:') ||
                      id.startsWith('contact:') ||
                      id.startsWith('_:')
                    ) {
                      ids.add(id);
                    }
                  });
                }
              });

              // side cases
              const rootId = getRootPartId(doc);
              if (
                rootId &&
                (rootId.startsWith('journal:') ||
                  rootId.startsWith('org:') ||
                  rootId.startsWith('graph:'))
              ) {
                ids.add(rootId);
              }
            }
          }
        });

        ids = Array.from(ids);
        _ids = Array.from(_ids);
        stripeIds = Array.from(stripeIds);

        // get the _id of all ids and stripeIds
        asyncParallel(
          {
            _idsFromStripeIds: cb => {
              asyncMapSeries(
                stripeIds,
                (stripeId, cb) => {
                  this.getStripeObject(stripeId, { store }, cb);
                },
                (err, stripeObjects) => {
                  if (err) return cb(err);
                  cb(
                    null,
                    stripeObjects.map(
                      object =>
                        createId(
                          'org',
                          unprefix(getId(object.metadata.organization))
                        )._id
                    )
                  );
                }
              );
            },
            _idsFromIds: cb => {
              const keys = ids.filter(
                id =>
                  id &&
                  !id.startsWith('node:') &&
                  !id.startsWith('cnode:') &&
                  !id.startsWith('role:') &&
                  !id.startsWith('srole:') &&
                  !id.startsWith('arole:') &&
                  !id.startsWith('audience:') &&
                  !id.startsWith('token:') &&
                  !id.startsWith('stripe:') &&
                  !id.startsWith('tag:') &&
                  !id.startsWith('contact:') &&
                  !id.startsWith('_:')
              );

              if (!keys.length) {
                return cb(null, []);
              }

              this.view.post(
                {
                  url: '/byId',
                  qs: {
                    reduce: false,
                    include_docs: false
                  },
                  json: {
                    keys
                  }
                },
                (err, resp, body) => {
                  if ((err = createError(err, resp, body))) return cb(err);
                  cb(
                    null,
                    arrayify(body.rows)
                      .filter(row => row.id)
                      .map(row => row.id)
                  );
                }
              );
            },
            _idsFromEmbeddedIds: cb => {
              const keys = ids.filter(
                id =>
                  id &&
                  (id.startsWith('node:') ||
                    id.startsWith('cnode:') ||
                    id.startsWith('role:') ||
                    id.startsWith('srole:') ||
                    id.startsWith('arole:') ||
                    id.startsWith('audience:') ||
                    id.startsWith('token:') ||
                    id.startsWith('stripe:') ||
                    id.startsWith('tag:') ||
                    id.startsWith('contact:') ||
                    id.startsWith('_:'))
              );

              if (!keys.length) {
                return cb(null, []);
              }

              this.view.post(
                {
                  url: '/byEmbeddedId',
                  qs: {
                    reduce: false,
                    include_docs: false
                  },
                  json: {
                    keys
                  }
                },
                (err, resp, body) => {
                  if ((err = createError(err, resp, body))) return cb(err);
                  cb(
                    null,
                    arrayify(body.rows)
                      .filter(row => row.id)
                      .map(row => row.id)
                  );
                }
              );
            }
          },
          (err, data) => {
            if (err) {
              return callback(err);
            }

            const keys = Array.from(
              new Set(
                _ids.concat(
                  data._idsFromIds,
                  data._idsFromEmbeddedIds,
                  data._idsFromStripeIds
                )
              )
            );

            const scope_ids = new Set();

            keys.forEach(key => {
              const [scopeId, type] = parseIndexableString(key);
              if (type === 'journal' || type === 'org') {
                scope_ids.add(key);
              } else if (type === 'service') {
                scope_ids.add(createId('org', scopeId)._id);
              } else if (
                type === 'issue' ||
                type === 'workflow' ||
                type === 'type'
              ) {
                scope_ids.add(createId('journal', scopeId)._id);
              } else if (type === 'action') {
                scope_ids.add(createId('graph', scopeId)._id);
                // CreatePeriodicalAction for instance is scoped under periodical id
                scope_ids.add(createId('journal', scopeId)._id);
                // CreateServiceAction for instance is scoped under organization id
                scope_ids.add(createId('org', scopeId)._id);
              } else if (type === 'node') {
                scope_ids.add(createId(scopeId.split(':')[0], scopeId)._id);
              } else if (
                type === 'graph' ||
                type === 'release' ||
                type === 'review'
              ) {
                scope_ids.add(createId('graph', scopeId)._id);
              }
            });

            if (!scope_ids.size) {
              return cb(null, []);
            }

            this.db.post(
              {
                url: '/_all_docs',
                qs: {
                  reduce: false,
                  include_docs: true
                },
                json: {
                  keys: Array.from(scope_ids)
                }
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) {
                  return cb(err);
                }
                const docs = getDocs(body);

                const periodicalAndOrg_ids = new Set();
                docs.forEach(doc => {
                  if (doc['@type'] === 'Graph') {
                    const periodicalId = getRootPartId(doc);
                    if (periodicalId) {
                      periodicalAndOrg_ids.add(
                        createId('journal', periodicalId)._id
                      );
                    }
                    const orgId = getId(doc.publisher);
                    if (orgId && orgId.startsWith('org:')) {
                      periodicalAndOrg_ids.add(createId('org', orgId)._id);
                    }
                  } else if (doc['@type'] === 'Periodical') {
                    const orgId = getId(doc.publisher);
                    if (orgId && orgId.startsWith('org:')) {
                      periodicalAndOrg_ids.add(createId('org', orgId)._id);
                    }
                  }
                });

                const keys = Array.from(periodicalAndOrg_ids).filter(
                  id => !scope_ids.has(id)
                );

                if (!keys.length) {
                  return cb(null, docs);
                }

                this.db.post(
                  {
                    url: '/_all_docs',
                    qs: {
                      reduce: false,
                      include_docs: true
                    },
                    json: {
                      keys
                    }
                  },
                  (err, resp, body) => {
                    if ((err = createError(err, resp, body))) {
                      return cb(err);
                    }
                    cb(null, docs.concat(getDocs(body)));
                  }
                );
              }
            );
          }
        );
      }
    },
    (err, res) => {
      if (err) return callback(err);

      store.add(res.scopes);
      if (res.activeInviteActions) {
        store.add(res.activeInviteActions);
      }

      // fetch missing docs if not in the store as we may need access to them to make the acl decision
      // Note that this is usually never needed as checkAcl is typically called by this.get that already fetched the docs...
      const toFetch = docs.filter(
        doc =>
          (typeof doc === 'string' || Object.keys(doc).length === 1) &&
          !store.has(doc)
      );

      this.get(toFetch, { acl: false, store }, (err, docs) => {
        if (err) {
          return callback(err);
        }

        const check = createCheckAcl(
          user,
          res.roles,
          res.scopes,
          res.activeInviteActions
        );

        const isAdmin = arrayify(res.roles).includes('admin');
        // for Promise support we add props to the function
        // check.userOrganizationIds = res.userOrganizationIds;
        check.isAdmin = isAdmin;
        check.userId = userId;
        check.store = store;
        check.activeInviteActions = res.activeInviteActions;

        callback(null, check, check.isAdmin, check.userId, check.store);
      });
    }
  );
}
