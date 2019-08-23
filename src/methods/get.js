import omit from 'lodash/omit';
import isPlainObject from 'lodash/isPlainObject';
import asyncParallel from 'async/parallel';
import asyncEach from 'async/each';
import uniqBy from 'lodash/uniqBy';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, dearrayify, arrayify } from '@scipe/jsonld';
import { getAgentId } from '../utils/schema-utils';
import createId from '../create-id';
import { getDocs } from '../low';
import { getVersion } from '../utils/workflow-utils';
import getScopeId from '../utils/get-scope-id';

// TODO handle conflicts see: https://github.com/scienceai/librarian/issues/174

/**
 * Get document by @id, slug or nash, username, email, _id
 * Note that a list of thereof can be provided
 *
 * !!! result ordering is NOT guaranteed to be the same as input ordering...
 *  TODO FIX ^^ ? Not super obvious with missing docs etc...
 */
export default function get(object, opts, callback) {
  if (!callback && typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!opts) opts = {};

  let {
    needAll = false, // if set to true we 404 if we get less document than requested
    fromCache = true,
    store,
    anonymize = false,
    acl, // boolean or user
    potentialActions: optsPotentialActions = 'bare', // `true`, `false`, `all`, `bare`, `dashboard`, `reader` or an object with a @type prop containing a list of @types
    lucene = false // boolean
  } = opts;

  if (optsPotentialActions === 'true' || optsPotentialActions === 'false') {
    // cast to proper boolean
    optsPotentialActions = optsPotentialActions === 'true';
  }

  // Get a doc (or list of doc)
  const objects = arrayify(object).filter(Boolean);
  if (!objects.length) {
    return callback(null, object);
  }

  // Try to return request from the store
  if (
    store &&
    fromCache &&
    optsPotentialActions === 'bare' &&
    !acl &&
    !anonymize
  ) {
    const ids = objects.map(object => getId(object)).filter(Boolean);
    if (ids.length === objects.length) {
      if (store.has(ids)) {
        let docs = ids.map(id => store.get(id));
        if (!lucene) {
          docs = docs.map(doc => omit(doc, ['@lucene']));
        }
        return callback(null, dearrayify(object, docs));
      }
    }
  }

  // Grab the identifiers...
  // We always favor _id and _all_docs instead of the /byId view
  const _ids = [];
  const ids = [];

  objects.forEach(object => {
    let _id, type;
    if (object._id || typeof object === 'string') {
      try {
        [, type] = parseIndexableString(object._id || object);
      } catch (e) {
        // noop
      }

      if (
        type === 'type' ||
        type === 'workflow' ||
        type === 'role' ||
        type === 'blank' ||
        type === 'graph' ||
        type === 'org' ||
        type === 'journal' ||
        type === 'service' ||
        type === 'release' ||
        type === 'action' ||
        type === 'profile' ||
        type === 'issue' ||
        type === 'stripe' ||
        type === 'user'
      ) {
        _id = object._id || object;
      }
    }

    if (_id) {
      _ids.push(_id);
    } else {
      // @id case
      // special case profiles, username and graphs
      const id = getId(object);
      if (typeof id === 'string') {
        if (id.startsWith('user:')) {
          _ids.push(createId('profile', id)._id);
        } else if (id.startsWith('org.couchdb.user:')) {
          // couchdb user, we trade it for a profile
          _ids.push(
            createId('profile', id.replace('org.couchdb.user:', ''))._id
          );
        } else {
          // either a nornal @id, a slug, a versioned slug, a username, we try everything

          if (
            (id.startsWith('_:') || id.startsWith('node:')) &&
            !getVersion(id) &&
            ((object.contentUrl &&
              object.contentUrl.startsWith('/encoding/') &&
              getVersion(object.contentUrl)) ||
              (object.isNodeOf && getVersion(object.isNodeOf)))
          ) {
            const version =
              getVersion(object.contentUrl) || getVersion(object.isNodeOf);
            ids.push(`${id}?version=${version}`);
          } else {
            ids.push(id);
          }

          if (!/^.*:/.test(id)) {
            _ids.push(createId('profile', id)._id);
          }
        }
      }
    }
  });

  asyncParallel(
    {
      allDocs: cb => {
        if (!_ids.length) {
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
              keys: _ids
            }
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return cb(err);
            }
            cb(null, body.rows.filter(row => row.doc).map(row => row.doc));
          }
        );
      },

      byId: cb => {
        // We exlude embedded nodes (node: role: arole: srole: contact:)
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

            cb(null, getDocs(body));
          }
        );
      },

      embedded: cb => {
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
          return cb(null, { docs: [], parentDocs: [] });
        }

        this.view.post(
          {
            url: '/byEmbeddedId',
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
            // console.log(require('util').inspect(body, { depth: null }));

            const docs = [];
            const parentDocs = [];
            body.rows.forEach(row => {
              if (row.doc && row.key) {
                // embedded nodes
                if (row.doc['@type'] === 'Graph') {
                  const [id] = row.key.split('?');
                  const doc = arrayify(row.doc['@graph']).find(
                    node => node['@id'] === id
                  );
                  if (doc) {
                    docs.push(
                      Object.assign(
                        {
                          isNodeOf: getId(row.doc)
                        },
                        doc
                      )
                    );
                    if (
                      !parentDocs.some(
                        parentDoc => parentDoc['@id'] === row.doc['@id']
                      )
                    ) {
                      parentDocs.push(row.doc);
                    }
                  }
                }

                // embedded roles
                if (
                  (row.doc['@type'] === 'Graph' && row.doc.version == null) ||
                  row.doc['@type'] === 'Periodical'
                ) {
                  const role = arrayify(row.doc.creator)
                    .concat(
                      row.doc.author,
                      row.doc.contributor,
                      row.doc.reviewer,
                      row.doc.editor,
                      row.doc.producer
                    )
                    .find(role => {
                      const roleId = getId(role);
                      return (
                        roleId &&
                        roleId.startsWith('role:') &&
                        getId(role) === row.key
                      );
                    });
                  if (role) {
                    docs.push(
                      Object.assign(
                        { isNodeOf: getId(row.doc) },
                        isPlainObject(role) ? role : { '@id': getId(role) }
                      )
                    );
                    if (
                      !parentDocs.some(
                        parentDoc => getId(parentDoc) === getId(row.doc)
                      )
                    ) {
                      parentDocs.push(row.doc);
                    }
                  }
                }

                // embedded contact points
                if (
                  row.doc.contactPoint &&
                  (row.doc['@type'] === 'Person' ||
                    row.doc['@type'] === 'Organization')
                ) {
                  const contactPoint = arrayify(row.doc.contactPoint).find(
                    contactPoint => getId(contactPoint) === row.key
                  );

                  if (contactPoint) {
                    docs.push(
                      Object.assign(
                        { isNodeOf: getId(row.doc) },
                        isPlainObject(contactPoint)
                          ? contactPoint
                          : { '@id': getId(contactPoint) }
                      )
                    );
                    if (
                      !parentDocs.some(
                        parentDoc => getId(parentDoc) === getId(row.doc)
                      )
                    ) {
                      parentDocs.push(row.doc);
                    }
                  }
                }

                // embeded style, style encoding and assets (logo, image, audio, video)
                if (
                  (row.doc['@type'] === 'Graph' &&
                    row.doc.version != null &&
                    /latest$/.test(row.doc._id)) ||
                  row.doc['@type'] === 'Person' ||
                  row.doc['@type'] === 'Organization' ||
                  row.doc['@type'] === 'Service' ||
                  row.doc['@type'] === 'Periodical' ||
                  row.doc['@type'] === 'PublicationType' ||
                  row.doc['@type'] === 'PublicationIssue' ||
                  row.doc['@type'] === 'SpecialPublicationIssue'
                ) {
                  ['style', 'logo', 'image', 'audio', 'video'].forEach(p => {
                    arrayify(row.doc[p]).forEach(resource => {
                      if (getId(resource) === row.key) {
                        docs.push(
                          Object.assign(
                            {
                              isNodeOf: getId(row.doc)
                            },
                            resource
                          )
                        );
                        if (
                          !parentDocs.some(
                            parentDoc => getId(parentDoc) === getId(row.doc)
                          )
                        ) {
                          parentDocs.push(row.doc);
                        }
                      }

                      const encodings = arrayify(resource.encoding).reduce(
                        (encodings, encoding) => {
                          return encodings.concat(
                            encoding,
                            arrayify(encoding.thumbnail)
                          );
                        },
                        []
                      );
                      const encoding = encodings.find(
                        encoding => getId(encoding) === row.key
                      );

                      if (encoding) {
                        docs.push(
                          Object.assign(
                            {
                              encodesCreativeWork: {
                                '@id': getId(resource),
                                isNodeOf: getId(row.doc)
                              }
                            },
                            encoding
                          )
                        );
                        if (
                          !parentDocs.some(
                            parentDoc => getId(parentDoc) === getId(row.doc)
                          )
                        ) {
                          parentDocs.push(row.doc);
                        }
                      }
                    });
                  });
                }
              }
            });
            return cb(null, { docs, parentDocs });
          }
        );
      }
    },
    (err, res) => {
      if (err) {
        return callback(err);
      }

      let docs = res.allDocs.concat(res.byId, res.embedded.docs);
      if (!docs || !docs.length) {
        this.log.debug({ object }, 'librarian.get no result');
        return callback(
          createError(
            404,
            `not found ${arrayify(object)
              .map(doc => getId(doc) || doc._id)
              .filter(Boolean)
              .join(', ')}`
          )
        );
      }

      if (store) {
        store.add(docs);
        store.add(res.embedded.parentDocs);
      }

      if (needAll && arrayify(object).length > docs.length) {
        return callback(
          createError(
            404,
            `not found ${arrayify(object)
              .map(doc => getId(doc) || doc._id)
              .filter(
                id =>
                  id && !docs.some(doc => getId(doc) === id || doc._id === id)
              )
              .join(', ')}`
          )
        );
      }

      if (!lucene) {
        docs = docs.map(doc => omit(doc, ['@lucene']));
      }

      maybeFetchPotentialActions.call(
        this,
        docs,
        { store, acl, lucene, optsPotentialActions },
        (err, potentialActionMap) => {
          if (err) return callback(err);

          if (store) {
            Object.keys(potentialActionMap).forEach(key => {
              store.add(potentialActionMap[key]);
            });
          }

          // add potentialAction to doc
          docs.forEach(doc => {
            if (optsPotentialActions === false) {
              delete doc.potentialAction;
            } else if (doc['@id'] in potentialActionMap) {
              doc.potentialAction = potentialActionMap[doc['@id']];
            }
          });

          this.checkReadAcl(docs, { store, acl }, (err, safeDocs) => {
            this.anonymize(
              safeDocs,
              {
                viewer: String(acl) === 'true' ? this.userId : getAgentId(acl),
                anonymize,
                store
              },
              (errAnonymized, safeDoc) => {
                if (errAnonymized) {
                  return callback(errAnonymized);
                }

                if (err) {
                  // Note, we still return the filtered safeDocs in case of errors as caller may want to do smtg with them...
                  if (Array.isArray(object)) {
                    err.body = safeDocs;
                    callback(err, safeDocs, res.embedded.parentDocs);
                  } else {
                    err.body = safeDocs && safeDocs[0];
                    callback(
                      err,
                      safeDocs && safeDocs[0],
                      res.embedded.parentDocs && res.embedded.parentDocs[0]
                    );
                  }
                } else {
                  if (Array.isArray(object)) {
                    callback(null, safeDocs, res.embedded.parentDocs);
                  } else {
                    if (docs.length > 1) {
                      this.log.error(
                        { res, object, docs },
                        `librarian.get more than one document available in librarian.get when called expecting 1 document ${getId(
                          object
                        ) || object._id}`
                      );

                      callback(
                        createError(
                          500,
                          `more than one document available when getting ${getId(
                            object
                          ) || object._id}`
                        )
                      );
                    } else {
                      callback(null, safeDocs[0], res.embedded.parentDocs[0]);
                    }
                  }
                }
              }
            );
          });
        }
      );
    }
  );
}

/**
 * handle `potentialActions` option
 * Note: acl is handled further downstream as part of the parent doc thanks to
 * checkReacAclSync that checks for the parent potential action
 */
function maybeFetchPotentialActions(
  docs,
  { store, acl, lucene, optsPotentialActions } = {},
  callback
) {
  if (
    optsPotentialActions === false ||
    optsPotentialActions === 'false' ||
    optsPotentialActions === 'bare'
  ) {
    return callback(null, {});
  }

  // TODO refactor:
  // - create a getPotentialActions view taking `all`, `true|false` or an `object` {'@type': []} as opts
  // - get the actions
  // - create the potentialActionMap

  if (optsPotentialActions === 'all') {
    // we get all the actions associated with an object ignoring
    // that the object of the action may refer to a specific
    // version of versions for the Graph
    const objects = uniqBy(docs.filter(doc => getId(doc)), doc => getId(doc));
    const potentialActionMap = {};
    asyncEach(
      objects,
      (object, cb) => {
        this.getActionsByObjectScopeId(object, { store }, (err, actions) => {
          if (err) {
            return cb(err);
          }

          const key = getId(object);
          potentialActionMap[key] = arrayify(potentialActionMap[key]).concat(
            actions
          );
          const versionlessKey = key.split('?')[0];
          if (versionlessKey !== key) {
            potentialActionMap[versionlessKey] = arrayify(
              potentialActionMap[versionlessKey]
            ).concat(actions);
          }
          cb(null);
        });
      },
      err => {
        if (err) return callback(err);
        callback(null, potentialActionMap);
      }
    );
  } else if (
    optsPotentialActions === 'dashboard' ||
    optsPotentialActions === 'reader'
  ) {
    // Get the TagAction (`dashboard`) and the StartWorklowStageAction (`dashboard` and `reader`))
    // This is usefull to have a reasonably performant loading time for the
    // app-suite where we need to render the timeline, the tags and / or the workflow badge
    const potentialActionMap = {};

    const scopeIds = Array.from(
      new Set(
        docs
          .filter(doc => doc && doc['@type'] === 'Graph')
          .map(doc => getScopeId(doc))
          .filter(Boolean)
      )
    );

    this.view.post(
      {
        url: '/actionsByScopeIdAndType',
        json: {
          keys:
            optsPotentialActions === 'reader'
              ? scopeIds.map(scopeId => [scopeId, 'StartWorkflowStageAction'])
              : scopeIds
                  .map(scopeId => [scopeId, 'TagAction'])
                  .concat(
                    scopeIds.map(scopeId => [
                      scopeId,
                      'StartWorkflowStageAction'
                    ])
                  )
        },
        qs: {
          reduce: false,
          include_docs: true
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return callback(err);
        }

        const byScopeId = body.rows.reduce((map, row) => {
          const [scopeId] = row.key;
          map[scopeId] = map[scopeId] || [];
          map[scopeId].push(row.doc);

          return map;
        }, {});

        docs.forEach(doc => {
          if (getId(doc) && doc['@type'] === 'Graph') {
            const scopeId = getScopeId(doc);
            if (scopeId && byScopeId[scopeId]) {
              potentialActionMap[getId(doc)] = byScopeId[scopeId];
              potentialActionMap[scopeId] = byScopeId[scopeId];
            }
          }
        });

        callback(null, potentialActionMap);
      }
    );
  } else if (optsPotentialActions === true) {
    // for journal and services we only attach the workflow as there can be a lot of potential actions for these types
    const journalIds = new Set();
    const otherIds = new Set();
    docs.forEach(doc => {
      let type;
      if (doc._id) {
        type = parseIndexableString(doc._id)[1];
      }
      if (doc['@id']) {
        if (type === 'journal' || type === 'service') {
          journalIds.add(doc['@id']);
        } else {
          otherIds.add(doc['@id']);
        }
      }
    });

    asyncParallel(
      {
        journal: cb => {
          this.view.post(
            {
              url: 'actionByObjectIdAndType',
              qs: {
                reduce: false,
                include_docs: true
              },
              json: {
                keys: Array.from(journalIds, id => [id, 'workflow'])
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return cb(err);
              }
              cb(
                null,
                arrayify(body.rows).reduce((potentialActionMap, row) => {
                  if (row.doc) {
                    const id = row.key[0];
                    if (potentialActionMap[id]) {
                      potentialActionMap[id].push(row.doc);
                    } else {
                      potentialActionMap[id] = [row.doc];
                    }
                  }
                  return potentialActionMap;
                }, {})
              );
            }
          );
        },
        other: cb => {
          this.view.post(
            {
              url: 'actionByObjectId',
              qs: {
                reduce: false,
                include_docs: true
              },
              json: {
                keys: Array.from(otherIds)
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return cb(err);
              }
              cb(
                null,
                arrayify(body.rows).reduce((potentialActionMap, row) => {
                  if (row.doc) {
                    const id = row.key;
                    if (potentialActionMap[id]) {
                      potentialActionMap[id].push(row.doc);
                    } else {
                      potentialActionMap[id] = [row.doc];
                    }
                  }
                  return potentialActionMap;
                }, {})
              );
            }
          );
        }
      },
      (err, res) => {
        if (err) return callback(err);
        callback(null, Object.assign(res.journal, res.other));
      }
    );
  } else if (isPlainObject(optsPotentialActions)) {
    const objectIds = uniqBy(
      docs.filter(doc => doc['@id']),
      doc => doc['@id']
    ).map(object => object['@id']);

    let keys = [];
    arrayify(optsPotentialActions['@type']).forEach(type => {
      keys = keys.concat(objectIds.map(id => [id, type]));
    });

    this.view.post(
      {
        url: 'actionByObjectIdAndType',
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
          return callback(err);
        }

        const potentialActionMap = arrayify(body.rows).reduce(
          (potentialActionMap, row) => {
            if (row.doc) {
              const id = row.key[0];
              if (potentialActionMap[id]) {
                potentialActionMap[id].push(row.doc);
              } else {
                potentialActionMap[id] = [row.doc];
              }
            }
            return potentialActionMap;
          },
          {}
        );

        callback(null, potentialActionMap);
      }
    );
  } else {
    callback(createError(400, 'Invalid value for potentialsActions option'));
  }
}
