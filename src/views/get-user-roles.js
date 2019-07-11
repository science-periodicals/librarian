import pick from 'lodash/pick';
import uniqBy from 'lodash/uniqBy';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify, nodeify, getNodeMap } from '@scipe/jsonld';
import { getDocs } from '../low';
import {
  getGraphMainEntityContributorRoles,
  parseRoleIds
} from '../utils/role-utils';
import { getRootPartId } from '../utils/schema-utils';

/**
 * Returns a `ContributorRole` list enriched with `roleAction` (restricted to
 * completed workflow action) for `Graph` roles
 *
 * e.g
 *
 * [
 *   {
 *     '@id': 'role:roleId',
 *     '@type': 'ContributorRole',
 *     startDate: '2018-06-25T17:30:41.652Z',
 *     endDate: '2019-06-25T17:30:41.652Z',
 *     roleName: 'reviewer',
 *     isNodeOf: 'journal:journalId',
 *     roleAction: [
 *       {
 *         '@type': 'ReviewAction',
 *         startTime: '2018-06-25T17:30:41.652Z',
 *         endTime: '2019-06-25T17:30:41.652Z',
 *         object: 'graph:graphId'
 *       }
 *     ]
 *   }
 * ]
 */
export default function getUserRoles(userId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  userId = getId(userId);

  this.view.get(
    {
      url: '/byContributorUserId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify(userId)
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let docs = uniqBy(getDocs(body), doc => getId(doc));
      if (store) {
        // View data can be out of date as compared to the store (CouchDB 2.x &
        // eventual consistency) so we regenerate the results from the store
        store.add(docs);
        docs.getAll().filter(doc => {
          if (doc._id) {
            const [, type] = parseIndexableString(doc._id);
            if (type === 'graph' || type === 'journal') {
              return (
                [
                  'author',
                  'contributor',
                  'reviewer',
                  'editor',
                  'producer'
                ].some(p => {
                  return arrayify(doc[p]).some(role => {
                    const { userId } = parseRoleIds(role);
                    return !!userId;
                  });
                }) ||
                getGraphMainEntityContributorRoles(doc, {
                  rootOnly: true
                }).some(role => {
                  const { userId } = parseRoleIds(role);
                  return !!userId;
                })
              );
            }
          }
        });
      }

      const journalIds = new Set();
      docs.forEach(doc => {
        if (doc['@type'] === 'Periodical') {
          journalIds.add(getId(doc));
        } else if (doc['@type'] === 'Graph') {
          const journalId = getRootPartId(doc);
          if (journalId && journalId.startsWith('journal:')) {
            journalIds.add(journalId);
          }
        }
      });

      const missingJournalIds = new Set();
      docs.forEach(doc => {
        if (doc['@type'] === 'Graph') {
          const journalId = getRootPartId(doc);
          if (
            journalId &&
            journalId.startsWith('journal:') &&
            !journalIds.has(journalId)
          ) {
            missingJournalIds.add(journalId);
          }
        }
      });

      // get missing journal ids
      this.get(
        Array.from(missingJournalIds),
        { store, acl: false },
        (err, journals) => {
          if (err && err.code !== 404) {
            return callback(err);
          }

          const droplets = Object.assign(
            getNodeMap(docs),
            getNodeMap(arrayify(journals))
          );

          const roles = [];
          docs.forEach(doc => {
            ['author', 'contributor', 'reviewer', 'editor', 'producer'].forEach(
              p => {
                arrayify(doc[p]).forEach(role => {
                  const { userId: _userId } = parseRoleIds(role);
                  if (_userId === userId) {
                    roles.push(formatRole(role, doc, droplets));
                  }
                });
              }
            ) ||
              getGraphMainEntityContributorRoles(doc, {
                rootOnly: true
              }).some(role => {
                const { userId: _userId } = parseRoleIds(role);
                if (_userId === userId) {
                  roles.push(formatRole(role, doc, droplets));
                }
              });
          });

          callback(null, roles);
        }
      );
    }
  );
}

function formatRole(role, doc, droplets) {
  // Note: `anonymize` may remove the roleId and `isNodeOf` for Graph roles
  // (based on `ViewIdentityPermission`) in order not to leak identity
  const overwrite = {};
  if (doc['@type'] === 'Graph') {
    overwrite.isNodeOf = pick(doc, [
      '@id',
      '@type',
      'name',
      'alternateName',
      'url'
    ]);
    const journalId = getRootPartId(doc);
    if (
      journalId &&
      journalId.startsWith('journal:') &&
      journalId in droplets
    ) {
      overwrite.isNodeOf.isPartOf = pick(droplets[journalId], [
        '@id',
        '@type',
        'name',
        'alternateName',
        'url'
      ]);
    }

    const roleActions = doc['@lucene']
      .filter(
        action =>
          getId(action.agent) === getId(role) &&
          (action['@type'] === 'CreateReleaseAction' ||
            action['@type'] === 'DeclareAction' ||
            action['@type'] === 'PayAction' ||
            action['@type'] === 'ReviewAction' ||
            action['@type'] === 'AssessAction' ||
            action['@type'] === 'PayAction' ||
            action['@type'] === 'TypesettingAction' ||
            action['@type'] === 'PublishAction') &&
          action.actionStatus === 'CompletedActionStatus'
      )
      .map(action => {
        // prop required to compute "completion on time" stats
        // be sure it's anon safe
        return pick(action, [
          '@id',
          '@type',
          'startTime',
          'endTime',
          'expectedDuration'
        ]);
      });

    if (roleActions.length) {
      overwrite.roleAction = roleActions;
    }
  } else {
    overwrite.isNodeOf = pick(doc, [
      '@id',
      '@type',
      'name',
      'alternateName',
      'url'
    ]);
  }

  return Object.assign({}, nodeify(role), overwrite);
}
