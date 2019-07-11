import createError from '@scipe/create-error';
import once from 'once';
import omit from 'lodash/omit';
import uniq from 'lodash/uniq';
import pick from 'lodash/pick';
import isPlainObject from 'lodash/isPlainObject';
import flatten from 'lodash/flatten';
import querystring from 'querystring';
import asyncWhilst from 'async/whilst';
import { contextUrl, arrayify, getId } from '@scipe/jsonld';
import camelCase from 'camelcase';
import decamelize from 'decamelize';
import { getAgentId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import Store from '../utils/store';

const HYDRATABLE = new Set([
  'additionalType', // publication types
  'creator',
  'author',
  'contributor',
  'reviewer',
  'editor',
  'producer',
  'sender',
  'mainEntity', // To access manuscript title
  'isPartOf', // for journals
  'publisher', // for orgs
  'publishingPrinciples',
  'workflow',
  'resultOf', // mostly to get the CreateGraphAction for the timeline
  // --
  'agent',
  'participant',
  'recipient',
  'object',
  'instrument',
  'result',
  'resultReview',
  'resultComment',
  // --
  'publishedOn',
  'workFeatured',
  'actor',
  'attendee',
  'composer',
  'director',
  'funder',
  'sponsor',
  'organizer',
  'performer',
  'translator',
  // --
  'publicationTypeCoverage',
  'potentialWorkflow',
  // --
  'provider',
  'brokeredService',
  // --
  'orderedItem',
  'itemOffered',
  'acceptedOffer',
  // --
  'isPublicationTypeOf',
  'isPotentialWorkflowOf',
  'eligibleWorkflow',
  // --
  'hasPart', // for special issues
  // -- magic props
  'scope' // add the scopes (graph, journal or org) to the @graph entries. This is usefull for notifications when the object of an action is a release but we have access to the live graph to get the proper blinding data reflecting the latest contributor of the Graph (reviewers etc.)
]);

let LINKED_FACETS = [
  'aboutId',
  'creatorId',
  'journalId',
  'authorId',
  'editorId',
  'reviewerId',
  'contributorId',
  'producerId',
  'agentId',
  'participantId',
  'recipientId',
  'sponsorId',
  'funderId',
  'tagId',
  'additionalTypeId'
];

LINKED_FACETS = LINKED_FACETS.concat(
  LINKED_FACETS.map(p => 'entity' + p.charAt(0).toUpperCase() + p.slice(1))
);

/**
 * Note: ACL is done by appending a part to the query to restrict search result
 * to value compatible with ACL rules. We add a limitation: user can only query for
 * agent, participient, recipient, author, reviewer etc. of graphs and actions if
 * the queried userId is the user himself. This is to avoid leaking information in
 * case of anonymized users.
 * Note that on the lucene side, we only index the given name, family name
 * etc. if the public can view identity
 *
 * opts.facetQuery is weird: it is used by the App Suite to return
 * updated counts when we use the search to reload a graph in response
 * to the changes feed
 *
 * See https://console.bluemix.net/docs/services/Cloudant/api/search.html#query-parameters
 * for all options
 *
 * TODO add an option to specify which doc the caller already have to
 * reduce the amount of doc to refetch when used with the `hydrate` option
 */
export default function search(
  indexName,
  query, // query parameter sent to Cloudant. Note: for legacy reasons we allow to pass some property of `opts` in the `query` object. !! all value specified in query must be proper JS objects
  opts,
  callback
) {
  if (!callback && typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!opts) opts = {};

  switch (indexName) {
    case 'user':
    case 'profile':
      indexName = 'profile';
      break;
    case 'journal':
    case 'periodical':
      indexName = 'journal';
      break;

    case 'org':
    case 'organization':
      indexName = 'organization';
      break;

    case 'graph':
    case 'release':
      indexName = 'graph';
      break;

    case 'issue':
    case 'workflow':
    case 'service':
    case 'action':
    case 'type':
      // no need to remap
      break;

    default:
      return callback(createError(400, 'invalid indexName'));
  }

  // Validate and split out `query` and `opts`

  // some options are exposed to the API as query string parameters, we handle that here by adding them to `opts`
  // + we add default
  const exposedBooleans = ['potentialActions', 'nodes', 'addActiveRoleIds'];
  opts = Object.assign(
    pick(query, exposedBooleans),
    {
      store: new Store()
    },
    opts
  );
  exposedBooleans.forEach(p => {
    if (p in opts) {
      if (opts[p] === 'true') {
        opts[p] = true;
      } else if (opts[p] === 'false') {
        opts[p] = false;
      }
    }
  });

  if (query.hydrate) {
    opts = Object.assign({ hydrate: query.hydrate }, opts);
  }

  if (query.defaultFacetQuery && query.facetQuery) {
    return callback(
      createError(
        400,
        'defaultFacetQuery and facetQuery option cannot be used simulataneously, use one or the other'
      )
    );
  }

  if (query.defaultFacetQuery) {
    opts = Object.assign({ defaultFacetQuery: query.defaultFacetQuery }, opts);
  }

  if (query.facetQuery) {
    opts = Object.assign({ facetQuery: query.facetQuery }, opts);
  }

  if (
    opts.hydrate &&
    (!Array.isArray(opts.hydrate) || opts.hydrate.some(p => !HYDRATABLE.has(p)))
  ) {
    return callback(createError(400, 'invalid value for hydrate'));
  }

  // The qs parameter per se (that will be sent to Cloudant) (without the subset treated as `opts`)
  // API support the camelCase version of the CouchDB params so we handle that here
  const supported = [
    'query',
    'include_fields',
    'include_docs',
    'bookmark',
    'counts',
    'limit',
    'ranges',
    'sort',
    'q'
  ];
  const camels = supported.filter(x => ~x.indexOf('_')).map(x => camelCase(x));

  let qs = pick(query, supported.concat(camels));
  camels.forEach(camel => {
    if (qs[camel]) {
      qs[decamelize(camel)] = qs[camel];
      delete qs[camel];
    }
  });
  Object.keys(qs).forEach(key => {
    if (qs[key] === 'true') {
      qs[key] = true;
    } else if (qs[key] === 'false') {
      qs[key] = false;
    }
  });

  if (qs.q && !qs.query) {
    qs.query = qs.q;
  }
  delete qs.q;

  if (!qs.query) {
    qs.query = '*:*';
  }

  if (!qs.include_fields) {
    qs.include_fields = ['@id'];
  } else {
    if (!Array.isArray(qs.include_fields)) {
      return callback(
        createError(
          400,
          'invalid querystring parameter for include fields (must be an array)'
        )
      );
    }
    if (!qs.include_fields.includes('@id')) {
      qs.include_fields = qs.include_fields.concat('@id');
    }
  }

  if (!qs.limit) {
    qs.limit = 25;
  }

  makeAclCompliant.call(this, indexName, qs, opts, (err, qs, opts) => {
    if (err) return callback(err);

    addActiveRoleIds.call(this, qs, opts, (err, qs, opts) => {
      if (err) return callback(err);

      this._search.post(
        {
          url: `/${indexName}`,
          json: omit(qs, ['include_docs']) // we omit include_docs as we re-do it manually to have the nodes, potential actions etc..
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return callback(err);
          }

          getFacets.call(
            this,
            indexName,
            opts.facetQuery ? query.counts : body.counts,
            opts.facetQuery ? query.ranges : body.ranges,
            qs,
            opts,
            (err, facets) => {
              if (err) return callback(err);
              let payload = Object.assign(
                {
                  '@context': contextUrl,
                  '@type': 'SearchResultList',
                  numberOfItems: body.total_rows,
                  itemListOrder: qs.sort || 'relevance',
                  itemListElement: body.rows.map((row, i) => {
                    const listItem = {
                      '@type': 'ListItem',
                      item:
                        row.doc || Object.assign({ _id: row.id }, row.fields)
                    };
                    if (i === body.rows.length - 1) {
                      // !! query is in JS => we need to recreate JSON values for `hydrate`, `counts`, `includeFields`, `ranges` and `sort`
                      listItem.nextItem = `${opts.baseUrl ||
                        ''}?${querystring.stringify(
                        Object.assign(
                          {},
                          query,
                          { bookmark: body.bookmark },
                          Array.isArray(query.hydrate)
                            ? { hydrate: JSON.stringify(query.hydrate) }
                            : undefined,
                          Array.isArray(query.counts)
                            ? { counts: JSON.stringify(query.counts) }
                            : undefined,
                          query.sort
                            ? { sort: JSON.stringify(query.sort) }
                            : undefined,
                          query.ranges
                            ? { ranges: JSON.stringify(query.ranges) }
                            : undefined,
                          query.includeFields
                            ? {
                                includeFields: JSON.stringify(
                                  query.includeFields
                                )
                              }
                            : undefined
                        )
                      )}`;
                    }
                    return listItem;
                  })
                },
                facets.length ? { itemListFacet: facets } : undefined
              );

              // handle include_docs
              if (!qs.include_docs && !opts.hydrate) {
                return callback(null, payload);
              }

              this.get(
                payload.itemListElement.map(listItem => listItem.item),
                opts,
                (err, docs) => {
                  if (err) {
                    return callback(err);
                  }

                  maybeHydrate.call(this, docs, opts, (err, droplets) => {
                    if (err) {
                      return callback(err);
                    }

                    const docMap = docs.reduce((docMap, doc) => {
                      docMap[doc._id] = doc;
                      return docMap;
                    }, {});

                    payload = Object.assign(payload, {
                      itemListElement: payload.itemListElement.map(listItem =>
                        Object.assign(listItem, {
                          item:
                            docMap[listItem.item._id] ||
                            pick(listItem.item, ['_id', '@id'])
                        })
                      )
                    });

                    if (droplets) {
                      payload = {
                        '@context': contextUrl,
                        '@type': 'HydratedSearchResultList',
                        mainEntity: payload,
                        '@graph': droplets
                      };
                    }

                    this.anonymize(
                      payload,
                      {
                        viewer:
                          String(opts.acl) === 'true'
                            ? this.userId
                            : getAgentId(opts.acl),
                        anonymize: opts.anonymize || false,
                        store: opts.store,
                        now: opts.now
                      },
                      callback
                    );
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

function getLinks(uris, callback) {
  if (!uris.length) {
    callback(null, { rows: [] });
  } else {
    // get linked data
    this.view.post(
      {
        url: '/id2name',
        qs: {
          reduce: true,
          group: true
        },
        json: {
          keys: uris
        }
      },
      (err, resp, links) => {
        if ((err = createError(err, resp, links))) {
          return callback(err);
        }
        callback(null, links);
      }
    );
  }
}

function handleFacetQuery(indexName, counts, ranges, opts, callback) {
  if (opts.facetQuery) {
    this._search.post(
      {
        url: `/${indexName}`,
        json: {
          query: opts.facetQuery,
          counts,
          range: ranges ? ranges : undefined,
          include_docs: false,
          limit: 0
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return callback(err);
        }
        callback(null, body.counts, body.ranges);
      }
    );
  } else if (opts.defaultFacetQuery) {
    if (!counts) {
      return callback(null, counts, ranges);
    }

    // TODO check that ranges are never required with defaultFacetQuery opts
    this._search.post(
      {
        url: `/${indexName}`,
        json: {
          query: opts.defaultFacetQuery,
          counts: Object.keys(counts),
          include_docs: false,
          limit: 0
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return callback(err);
        }

        const allCounts = body.counts;
        // if a value i not in counts, set it to 0 in allCounts
        // we mutate allCounts in place
        Object.keys(allCounts).forEach(p => {
          if (!(p in counts)) {
            // should never happen
            if (allCounts[p] !== 0) {
              allCounts[p] = Object.keys(allCounts[p]).reduce((zeros, key) => {
                zeros[key] = 0;
                return zeros;
              }, {});
            }
          } else {
            if (allCounts[p] === 0) {
              allCounts[p] = counts[p] || 0;
            } else {
              allCounts[p] = Object.keys(allCounts[p]).reduce((values, key) => {
                if (typeof counts[p] === 'object' && key in counts[p]) {
                  values[key] = counts[p][key];
                } else {
                  values[key] = 0;
                }
                return values;
              }, {});
            }
          }
        });
        // should be unecessary but just in case the facetDefaultQuery is bugged:
        Object.keys(counts).forEach(p => {
          if (!(p in allCounts)) {
            allCounts[p] = counts[p];
          }
        });
        callback(null, allCounts, ranges);
      }
    );
  } else {
    callback(null, counts, ranges);
  }
}

function getFacets(indexName, counts, ranges, qs, opts, callback) {
  handleFacetQuery.call(
    this,
    indexName,
    counts,
    ranges,
    opts,
    (err, counts, ranges) => {
      // counts is an object like: `{ tag: { 'tag:author-tag': 1 } }`
      if (err) return callback(err);
      ensureFacetAcl.call(this, counts, ranges, opts, (err, counts, range) => {
        if (err) return callback(err);

        const uris = LINKED_FACETS.reduce((uris, facet) => {
          if (counts && counts[facet]) {
            uris = uris.concat(Object.keys(counts[facet]));
          }
          return uris;
        }, []);

        getLinks.call(this, uris, (err, links) => {
          if (err) return callback(err);
          const facets = [];
          if (counts) {
            const map = links.rows.reduce((map, row) => {
              map[row.key] = row.value;
              return map;
            }, {});

            Object.keys(counts).forEach(facet => {
              facets.push({
                '@type': 'Facet',
                name: facet,
                count:
                  counts[facet] &&
                  Object.keys(counts[facet])
                    .length /* counts[facet] can be 0 if no results */
                    ? Object.keys(counts[facet]).map(key => {
                        return Object.assign(
                          {
                            '@type': 'PropertyValue',
                            propertyId: key,
                            value: counts[facet][key]
                          },
                          map[key] ? { name: map[key] } : undefined
                        );
                      })
                    : 0
              });
            });
          }

          if (ranges) {
            Object.keys(ranges).forEach(facet => {
              facets.push({
                '@type': 'RangeFacet',
                name: facet,
                count: Object.keys(ranges[facet]).map(key => {
                  let minMaxValues;
                  if (
                    qs.ranges &&
                    qs.ranges[facet] &&
                    typeof qs.ranges[facet][key] === 'string'
                  ) {
                    const match = qs.ranges[facet][key].match(
                      /[[{]\s*([-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*TO\s*([-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*[\]}]/i
                    );
                    if (match) {
                      minMaxValues = {
                        minValue: parseFloat(match[1]),
                        maxValue: parseFloat(match[2])
                      };
                    }
                  }

                  return Object.assign(
                    {
                      '@type': 'PropertyValue',
                      propertyId: key,
                      value: ranges[facet][key]
                    },
                    minMaxValues
                  );
                })
              });
            });
          }

          callback(null, facets);
        });
      });
    }
  );
}

// counts is an object like: `{ tagId: { 'tag:author-tag': 1 } }`
function ensureFacetAcl(counts, ranges, opts = {}, callback) {
  if (!counts || !counts.tagId || !opts.acl || String(opts.acl) === 'false') {
    return callback(null, counts, ranges);
  }

  const agentId = getAgentId(opts.acl) || this.userId;
  this.getVisibleTagIds(agentId, { store: opts.store }, (err, tagIds) => {
    if (err) return callback(err);
    const visibleTagIdSet = new Set(tagIds);

    if (visibleTagIdSet.size) {
      counts = Object.assign({}, counts, {
        tagId: Object.keys(counts.tagId)
          .filter(tagId => visibleTagIdSet.has(tagId))
          .reduce((map, tagId) => {
            map[tagId] = counts.tagId[tagId];
            return map;
          }, {})
      });
    } else {
      counts = omit(counts, ['tagId']);
    }

    callback(null, counts, ranges);
  });
}

function getHydratedSet(docs = [], props = [], blackset = new Set()) {
  const hydratedSet = new Set();
  docs.forEach(doc => {
    let things = [doc];
    if (doc.potentialAction) {
      things = things.concat(doc.potentialAction);
    }

    things.forEach(thing => {
      props.forEach(p => {
        if (thing[p]) {
          arrayify(thing[p]).forEach(value => {
            // handle roles
            const id = getId(value);
            if (id && !blackset.has(id)) {
              hydratedSet.add(id);
            }
            const unroledId = getId(value[p]);
            if (unroledId && !blackset.has(unroledId)) {
              hydratedSet.add(unroledId);
            }
          });
        } else if (p === 'scope') {
          const scopeId = getScopeId(thing);
          if (
            scopeId &&
            (scopeId.startsWith('org:') ||
              scopeId.startsWith('journal:') ||
              scopeId.startsWith('graph:')) &&
            !blackset.has(scopeId)
          ) {
            hydratedSet.add(scopeId);
          }
        }
      });
    });
  });
  return hydratedSet;
}

function getHydratableDocs(doc, props = [], docs = []) {
  Object.keys(doc).forEach(p => {
    if (props.includes(p)) {
      arrayify(doc[p]).forEach(value => {
        if (
          isPlainObject(value) &&
          Object.keys(value).some(_p => props.includes(p))
        ) {
          docs.push(value);
          getHydratableDocs(value, props, docs);
        }
      });
    }
  });
  return docs;
}

function maybeHydrate(
  docs,
  { hydrate: hydratableProps, acl, store } = {},
  callback
) {
  if (!hydratableProps) {
    return callback(null, null);
  }

  // enrich docs with the embedded objects for the hydrated props
  // so if we have a doc like:
  // {
  //   result: {
  //     '@id': 'offer:typesetting',
  //     itemOffered: 'service:typesetting'
  //   }
  // };
  // we hydrate `service:typesetting`
  const hydratableDocs = arrayify(docs).concat(
    flatten(arrayify(docs).map(doc => getHydratableDocs(doc, hydratableProps)))
  );

  let hydratedSet = getHydratedSet(hydratableDocs, hydratableProps);
  let blackSet = new Set([...hydratedSet]);
  let allDroplets = [];

  asyncWhilst(
    () => {
      return hydratedSet.size > 0;
    },
    cb => {
      // Note: we do not anonymize here. Anonymization will be handled at the verry end
      this.get(Array.from(hydratedSet), { acl, store }, (err, droplets) => {
        // we ignore 401 and  403 as user might not have access to some of the droplets, but that's fine as librarian.get will have filtered out the forbidden docs
        if (
          err &&
          !err.code === 404 &&
          !((err.code === 401 || err.code === 403) && droplets)
        ) {
          return callback(err);
        }

        if (!droplets) {
          droplets = [];
        }

        hydratedSet = getHydratedSet(droplets, hydratableProps, blackSet);

        blackSet = new Set([...blackSet, ...hydratedSet]);
        allDroplets = allDroplets.concat(droplets);
        cb(null, allDroplets);
      });
    },
    (err, allDroplets) => {
      callback(err, allDroplets);
    }
  );
}

function makeAclCompliant(indexName, qs, opts, callback) {
  // handle acl: we add a lucene query term if the user is not an admin
  if (
    String(opts.acl) !== 'false' &&
    indexName !== 'workflow' && // always public
    indexName !== 'profile' && // always public
    indexName !== 'service' && // always public
    indexName !== 'type' && // always public
    indexName !== 'issue' // always public ? TODO improve (depends on journal being public ?)
  ) {
    this.checkAcl.call(
      this,
      pick(opts, ['acl', 'store']),
      (errCheckAcl, check, isAdmin) => {
        if (
          errCheckAcl &&
          !(
            (errCheckAcl.code === 403 || errCheckAcl.code === 401) &&
            (indexName === 'graph' ||
              indexName === 'journal' ||
              indexName === 'action')
          ) // for public graph, periodical and some actions (public ones) 401 / 403 are fine
        ) {
          return callback(errCheckAcl);
        }

        if (isAdmin) {
          return callback(null, qs, opts);
        }

        let userId;
        if (String(opts.acl) === 'true') {
          userId = this.userId;
        } else {
          userId = getAgentId(opts.acl);
        }
        // note: userId may be undefined (for instance the API use { acl: true } for public sifter).

        // handle view identity compliance (we preserve anonymity by not
        // allowing to query graph or action per userId (with the exception of
        // self))
        // TODO? This could be enhanced and relaxed later if needed
        if (indexName === 'action' || indexName === 'graph') {
          const sensitiveUserIds = getSensitiveUserIds(qs.query);
          if (
            (!userId && sensitiveUserIds.length) ||
            sensitiveUserIds.some(_userId => _userId !== userId)
          ) {
            return callback(
              createError(
                userId ? 403 : 401,
                `Invalid query, ${indexName} index cannot be queried for ${sensitiveUserIds.join(
                  ', '
                )}`
              )
            );
          }
        }

        let aclStr;
        if (indexName === 'action') {
          aclStr = `participantAudienceType:"public"`;

          if (userId) {
            if (!check) {
              return callback(errCheckAcl);
            }

            aclStr +=
              ' OR ' +
              ['agentId', 'participantId', 'recipientId']
                .map(index => `${index}:"${userId}"`)
                .join(' OR ');
          }
        } else if (indexName === 'organization') {
          if (!userId || !check) {
            return callback(errCheckAcl || createError(401));
          }

          aclStr = `adminPermission:"${userId}"`;
        } else if (userId) {
          if (!check) {
            return callback(errCheckAcl);
          }

          aclStr =
            'availability:public OR ' +
            [
              'creatorId',
              'authorId',
              'editorId',
              'contributorId',
              'producerId',
              'reviewerId'
            ]
              .concat(
                indexName === 'graph'
                  ? ['entityAuthorId', 'entityContributorId']
                  : []
              )
              .map(index => `${index}:"${userId}"`)
              .join(' OR ');
        } else {
          aclStr = 'availability:public';
        }

        qs = Object.assign({}, qs, {
          query: qs.query === '*:*' ? aclStr : `(${aclStr}) AND (${qs.query})`
        });

        if (opts.defaultFacetQuery) {
          opts = Object.assign({}, opts, {
            defaultFacetQuery:
              opts.defaultFacetQuery === '*:*'
                ? aclStr
                : `(${aclStr}) AND (${opts.defaultFacetQuery})`
          });
        }
        if (opts.facetQuery) {
          opts = Object.assign({}, opts, {
            facetQuery:
              opts.facetQuery === '*:*'
                ? aclStr
                : `(${aclStr}) AND (${opts.facetQuery})`
          });
        }
        callback(null, qs, opts);
      }
    );
  } else {
    callback(null, qs, opts);
  }
}

function getSensitiveUserIds(query = '') {
  // Note user:peter -> user\\:peter with escapeLucene so we make sure to include \ in the regexp
  const re = /(?:agentId|recipientId|participantId|creatorId|authorId|editorId|contributorId|producerId|reviewerId|entityAuthorId|entityContributorId):"?user\\?\\?:([a-zA-Z0-9\\:\-_]+)"?(?:\s|$)/g;

  const userIds = [];
  let res;
  while ((res = re.exec(query)) !== null) {
    const username = res[1];
    if (username) {
      userIds.push(`user:${username.replace(/\\/g, '')}`); // undo escapeLucene (\\)
    }
  }

  return Array.from(new Set(userIds));
}

function addActiveRoleIds(qs, opts, callback) {
  if (!opts.addActiveRoleIds) {
    return callback(null, qs, opts);
  }

  callback = once(callback);

  _addActiveRoleIds
    .call(this, qs, opts)
    .then(({ qs, opts }) => {
      callback(null, qs, opts);
    })
    .catch(callback);
}

// need to handle `qs.query`, `opts.defaultFacetQuery`, `opts.facetQuery`
async function _addActiveRoleIds(qs = {}, opts = {}) {
  let userId;
  if (String(opts.acl) === 'true') {
    userId = this.userId;
  } else {
    userId = getAgentId(opts.acl);
  }

  if (!userId) {
    return { qs, opts };
  }

  if (qs.query) {
    qs = Object.assign({}, qs, {
      query: await handleActiveRoleIds.call(this, userId, qs.query, {
        store: opts.store
      })
    });
  }

  if (opts.defaultFacetQuery) {
    opts = Object.assign({}, opts, {
      defaultFacetQuery: await handleActiveRoleIds.call(
        this,
        userId,
        opts.defaultFacetQuery,
        { store: opts.store }
      )
    });
  }

  if (opts.facetQuery) {
    opts = Object.assign({}, opts, {
      facetQuery: await handleActiveRoleIds.call(
        this,
        userId,
        opts.facetQuery,
        { store: opts.store }
      )
    });
  }

  return { qs, opts };
}

async function handleActiveRoleIds(userId, query, { store } = {}) {
  let nextQuery = query;
  const re = new RegExp(
    `((?:agentId|recipientId|participantId|authorId|reviewerId|editorId|producerId|entityAuthorId|entityContributorId):"?${JSON.stringify(
      userId
    )
      .replace(/^"/, '')
      .replace(/"$/, '')}"?)`,
    'g'
  );

  const matches = uniq(query.match(re));

  if (matches) {
    const roleIds = await this.getActiveGraphRoleIdsByUserId(userId, { store });
    for (const match of matches) {
      if (roleIds.length) {
        // replace all
        nextQuery = nextQuery
          .split(match)
          .join(
            `(${match} OR ${roleIds
              .map(roleId => `${match.split('Id:')[0]}RoleId:"${roleId}"`)
              .join(' OR ')})`
          );
      }
    }
    // console.log({ query, matches, nextQuery, roleIds, userId });
  }

  return nextQuery;
}
