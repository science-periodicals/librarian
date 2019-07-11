import crypto from 'crypto';
import traverse from 'traverse';
import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import {
  purge,
  unrole,
  dearrayify,
  arrayify,
  getNodeMap,
  getId,
  unprefix,
  nodeify
} from '@scipe/jsonld';
import schema from '../utils/schema';
import {
  getAgentId,
  getParts,
  getObjectId,
  getResultId,
  getInstrumentId,
  getTargetCollectionId,
  getAgent
} from '../utils/schema-utils';
import getVisibleRoleNames from '../utils/get-visible-role-names';
import { getSourceRoleId, parseRoleIds } from '../utils/role-utils';
import { BLINDED_PROPS, EDITABLE_OFFLINE_TYPES } from '../constants';
import findRole from '../utils/find-role';
import Store from '../utils/store';
import getScopeId from '../utils/get-scope-id';
import handleUserReferences from '../utils/handle-user-references';
import { encrypt } from '../crypto/encrypt';

const SENSITIVE_PROPS = [
  'roleContactPoint',
  'roleAffiliation',
  'affiliation',
  'contactPoint',
  'funder',
  'sponsor',
  'award'
];

/**
 * !! See documentation on how blinding works in `handle-user-references.js`
 * Note: we do _not_ need to anonymize UpdateAction object (update payload)
 * as the audience is guaranted to be safe (restricted to authors and producers)
 */
export default async function anonymize(
  payload, // 1 document or a list of documents to anonymize
  {
    viewer = { '@type': 'Audience', audienceType: 'public' },
    anonymize: anonymizeOpt = true,
    correlatedRoleIds = false, // when set to `true` the roleId and isNodeOf of Graph role will be removed (this is typically the case when calling `getUserRoles`)
    fromCache = true,
    now = new Date().toISOString(),
    store = new Store(),
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  // convenient shortcut when this is used with the callback API
  if (!anonymizeOpt) {
    return payload;
  }

  const docs = arrayify(payload);
  const anonymizedDocs = [];

  const inviteActions = await this.getActiveInviteActionByRecipientIdOrEmail(
    viewer,
    {
      store,
      fromCache
    }
  );

  try {
    for (const doc of docs) {
      let anonymizedDoc = await anonymizeDoc.call(this, doc, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      anonymizedDocs.push(anonymizedDoc);
    }
  } catch (err) {
    this.log.fatal({ err, payload }, 'Error in anonymize');
    throw err;
  }

  return dearrayify(payload, anonymizedDocs);
}

async function anonymizeDoc(
  doc,
  viewer,
  {
    now,
    store,
    fromCache,
    correlatedRoleIds,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  // TODO double check that and make flagDeleted anon safe if it's not
  if (doc._deleted) {
    return doc;
  }

  let anonymizedDoc;
  switch (doc['@type']) {
    case 'Graph': {
      anonymizedDoc = await anonymizeGraph.call(this, doc, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      break;
    }

    case 'SearchResultList':
    case 'HydratedSearchResultList': {
      anonymizedDoc = await anonymizeSearchResultList.call(this, doc, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      break;
    }

    // For the changes feed
    case 'DataFeed': {
      if (doc.dataFeedElement) {
        const anonymizedDataFeedElements = [];
        for (const dataFeedItem of arrayify(doc.dataFeedElement)) {
          const anonymizedDataFeedItem = await anonymizeDataFeedItem.call(
            this,
            dataFeedItem,
            viewer,
            {
              now,
              inviteActions,
              store,
              fromCache,
              correlatedRoleIds,
              ignoreEndDateOnPublicationOrRejection
            }
          );
          anonymizedDataFeedElements.push(anonymizedDataFeedItem);
        }
        anonymizedDoc = Object.assign({}, doc, {
          dataFeedElement: dearrayify(
            doc.dataFeedElement,
            anonymizedDataFeedElements
          )
        });
      } else {
        anonymizedDoc = doc;
      }
      break;
    }

    case 'DataFeedItem': {
      anonymizedDoc = await anonymizeDataFeedItem.call(this, doc, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      break;
    }

    case 'ServiceProviderRole':
    case 'ContributorRole': {
      anonymizedDoc = await anonymizeRole.call(this, doc, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      break;
    }

    default: {
      const objectId = getObjectId(doc);
      const resultId = getResultId(doc);
      const instrumentId = getInstrumentId(doc);
      const targetCollectionId = getTargetCollectionId(doc);

      if (
        schema.is(doc['@type'], 'Action') &&
        ((doc._id && doc._id.startsWith('graph:')) ||
          // _id may not be defined (e.g when we specify an UpdateAction template for
          // the result of a webify action
          (objectId && objectId.startsWith('graph:')) ||
          (resultId && resultId.startsWith('graph:')) ||
          (targetCollectionId && targetCollectionId.startsWith('graph:')) ||
          (instrumentId && instrumentId.startsWith('graph:')))
      ) {
        anonymizedDoc = await anonymizeGraphAction.call(this, doc, viewer, {
          now,
          inviteActions,
          store,
          fromCache,
          correlatedRoleIds,
          ignoreEndDateOnPublicationOrRejection
        });
      } else {
        anonymizedDoc = doc;
      }
      break;
    }
  }

  // post-processing (mostly for when librarian.post inline some results and potential actions)
  // Note: actions embedded in `StartWorkflowStageAction` are _always_ safe (we
  // never store the userId for it)
  for (const p of ['result', 'potentialAction']) {
    if (schema.is(anonymizedDoc['@type'], 'Action') && anonymizedDoc[p]) {
      const nodes = arrayify(anonymizedDoc[p]);
      const anonymizedNodes = [];
      for (const node of nodes) {
        const anonymizedNode = await anonymizeDoc.call(this, node, viewer, {
          now,
          inviteActions,
          store,
          fromCache,
          correlatedRoleIds,
          ignoreEndDateOnPublicationOrRejection
        });
        anonymizedNodes.push(anonymizedNode);
      }
      anonymizedDoc = Object.assign({}, anonymizedDoc, {
        [p]: dearrayify(anonymizedDoc[p], anonymizedNodes)
      });
    }
  }
  return anonymizedDoc;
}

/**
 * only takes care of `agent`, `participant` and `recipient`
 * Note: actions embedded in `StartWorkflowStageAction` are _always_ safe (we
 * never store the userId for it)
 */
async function anonymizeGraphAction(
  action,
  viewer,
  {
    now,
    store,
    fromCache,
    correlatedRoleIds,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  let scopeId;
  // _id may not be defined (e.g when we specify an UpdateAction template for
  // the result of a webify action
  if (action._id) {
    scopeId = getScopeId(action);
  }

  const targetCollectionId = getTargetCollectionId(action);
  if (targetCollectionId && targetCollectionId.startsWith('graph:')) {
    if (!scopeId || !scopeId.startsWith('graph:')) {
      scopeId = getScopeId(targetCollectionId);
    }
  }

  if (!scopeId || !scopeId.startsWith('graph:')) {
    const objectId = getObjectId(action);
    if (objectId && objectId.startsWith('graph:')) {
      scopeId = getScopeId(objectId);
    }
  }

  if (!scopeId || !scopeId.startsWith('graph:')) {
    return action;
  }

  const scope = await this.get(scopeId, {
    store,
    fromCache,
    acl: false
  });

  if (
    EDITABLE_OFFLINE_TYPES.has(action['@type']) &&
    (action.actionStatus === 'ActiveActionStatus' ||
      action.actionStatus === 'StagedActionStatus')
  ) {
    // Note `handleUserReferences` should have no effect and return `action` unchanged
    return handleUserReferences(action, scope);
  }

  // anonymize `agent`, `recipient` and `participant`
  const visibleRoleNames = getVisibleRoleNames(viewer, scope, {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection
  });

  // for graph action, all the value of agent, recipient or participant must be
  // roles from the Graph or audiences
  action = Object.assign({}, action); // we will mutate action
  ['agent', 'participant', 'recipient'].forEach(p => {
    if (action[p]) {
      action[p] = dearrayify(
        action[p],
        arrayify(action[p]).map(role => {
          if (
            role['@type'] === 'Audience' ||
            role['@type'] === 'AudienceRole'
          ) {
            return role;
          }

          // bot:scipe case
          if (
            p === 'agent' &&
            (getId(role) === 'bot:scipe' || getAgentId(role) === 'bot:scipe')
          ) {
            return role;
          }

          return maybeAnonymizeRole(
            role,
            viewer,
            visibleRoleNames,
            p,
            scope.encryptionKey,
            { correlatedRoleIds }
          );
        })
      );
    }
  });

  return action;
}

async function anonymizeDataFeedItem(
  dataFeedItem, // DataFeedItem
  viewer,
  {
    now,
    store,
    fromCache,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    correlatedRoleIds,
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  const { item } = dataFeedItem;
  if (item) {
    const anonymizedItem = await anonymizeDoc.call(this, item, viewer, {
      now,
      inviteActions,
      store,
      fromCache,
      correlatedRoleIds,
      ignoreEndDateOnPublicationOrRejection
    });

    return Object.assign({}, dataFeedItem, { item: anonymizedItem });
  }

  return dataFeedItem;
}

async function anonymizeSearchResultList(
  payload, // A SearchResultList or HydratedSearchResultList
  viewer,
  {
    now,
    store,
    fromCache,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    correlatedRoleIds,
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  const itemListElements = arrayify(
    (payload.mainEntity || payload).itemListElement
  );

  const anonymizedItemListElements = [];
  for (const itemListElement of itemListElements) {
    const { item } = itemListElement;

    const anonymizedItem = await anonymizeDoc.call(this, item, viewer, {
      now,
      inviteActions,
      store,
      fromCache,
      correlatedRoleIds,
      ignoreEndDateOnPublicationOrRejection
    });

    anonymizedItemListElements.push(
      Object.assign({}, itemListElement, { item: anonymizedItem })
    );
  }

  if (payload['@type'] === 'HydratedSearchResultList' && payload['@graph']) {
    // first we anonymize the droplets
    const anonymizedNodes = [];
    for (const node of arrayify(payload['@graph'])) {
      const anonymizedNode = await anonymizeDoc.call(this, node, viewer, {
        now,
        inviteActions,
        store,
        fromCache,
        correlatedRoleIds,
        ignoreEndDateOnPublicationOrRejection
      });
      anonymizedNodes.push(anonymizedNode);
    }

    // Further processing:
    // we need to be careful not to leak identity through the droplets
    // => we grab all the userIds reference in the `itemListElements` and filter out any extra user droplets
    const referencedUserIds = new Set();
    traverse(itemListElements).forEach(function(x) {
      if (typeof x === 'string' && x.startsWith('user:')) {
        referencedUserIds.add(x);
      }
    });

    payload = Object.assign({}, payload, {
      mainEntity: Object.assign({}, payload.mainEntity, {
        itemListElement: anonymizedItemListElements
      }),
      '@graph': anonymizedNodes.filter(node => {
        const nodeId = getId(node);
        return (
          !nodeId ||
          !nodeId.startsWith('user:') ||
          referencedUserIds.has(nodeId)
        );
      })
    });
  } else {
    payload = Object.assign({}, payload, {
      itemListElement: anonymizedItemListElements
    });
  }

  return payload;
}

async function anonymizeGraph(
  graph, // or release
  viewer, // user or audience like {'@type': 'Audience', 'audienceType': 'public'} or role
  {
    now,
    store,
    fromCache,
    correlatedRoleIds,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  viewer = findRole(viewer, graph, { now, active: false }) || viewer;
  const { userId: viewerUserId, roleId: viewerRoleId } = parseRoleIds(viewer);

  const scopeId = getScopeId(getId(graph));
  // we need the live graph as release may have outdated contribs (e.g a reviewer is added _after_ a release was made)
  const scope =
    scopeId === getId(graph)
      ? graph
      : await this.get(scopeId, {
          store,
          fromCache,
          acl: false
        });

  const visibleRoleNames = getVisibleRoleNames(viewer, scope, {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection
  });

  // open peer review => no need for anonymization
  if (
    visibleRoleNames.has('author') &&
    visibleRoleNames.has('reviewer') &&
    visibleRoleNames.has('editor') &&
    visibleRoleNames.has('producer')
  ) {
    return graph;
  }

  let anonymizedGraph = Object.keys(graph).reduce((anonymizedGraph, key) => {
    if (BLINDED_PROPS.includes(key)) {
      anonymizedGraph[key] = dearrayify(
        graph[key],
        arrayify(graph[key]).map(role => {
          return maybeAnonymizeRole(
            role,
            viewer,
            visibleRoleNames,
            key,
            scope.encryptionKey,
            { correlatedRoleIds }
          );
        })
      );
    } else if (key === '@graph') {
      // !! we work with flat nodes => we can't use `maybeAnonymizeRole `
      const nodeMap = getNodeMap(graph);
      const overwrite = {}; // Note: when we anonymize flat roles or affiliation we add new nodes to the graph and purge the graph in the end we also add those new nodes in the `overwrite` object

      const resources = [];
      const mainEntity = nodeMap[getId(graph.mainEntity)];
      if (mainEntity) {
        const parts = getParts(mainEntity, nodeMap);
        resources.push(mainEntity, ...parts);
      }

      resources.forEach(resource => {
        Object.keys(resource).forEach(key => {
          if (BLINDED_PROPS.includes(key)) {
            arrayify(resource[key]).forEach(roleId => {
              const role = nodeMap[roleId];

              if (role && role.roleName) {
                const { userId, roleId } = parseRoleIds(role);

                const unroledId = getId(unrole(role, key));
                const unroled = nodeMap[unroledId];

                if (unroledId && unroledId !== roleId) {
                  const anonId = `anon:${crypto
                    .createHash('sha256')
                    .update(
                      encrypt(
                        `${role.roleName}:${unprefix(unroledId)}`,
                        scope.encryptionKey
                      )
                    )
                    .digest('hex')}`;

                  if (
                    visibleRoleNames.has(role.roleName) ||
                    (userId && userId === viewerUserId) ||
                    (roleId && roleId === viewerRoleId)
                  ) {
                    // sameAs
                    overwrite[unroledId] = Object.assign(
                      {},
                      { '@id': unroledId },
                      nodeify(unroled),
                      {
                        sameAs: arrayify(unroled.sameAs)
                          .filter(uri => getId(uri) !== anonId)
                          .concat(anonId)
                      }
                    );
                  } else {
                    // anonymize
                    const anonymizedUnroled = createAnonymizedUser(
                      unroled,
                      anonId
                    );

                    const anonymizedRole = Object.assign(
                      omit(nodeify(role), SENSITIVE_PROPS),
                      {
                        [key]: anonId
                      }
                    );

                    overwrite[getId(anonymizedUnroled)] = anonymizedUnroled;
                    overwrite[getId(anonymizedRole)] = anonymizedRole;
                  }
                }
              }
            });
          }
        });
      });

      const nextNodeMap = Object.assign({}, nodeMap, overwrite);
      anonymizedGraph[key] = Object.keys(nextNodeMap).map(
        id => nextNodeMap[id]
      );
    } else {
      anonymizedGraph[key] = graph[key];
    }

    return anonymizedGraph;
  }, {});

  if (getId(anonymizedGraph.mainEntity)) {
    anonymizedGraph = await purge(anonymizedGraph, anonymizedGraph.mainEntity, {
      preserveUuidBlankNodes: true,
      removeUnnecessaryBlankNodeIds: true
    });
  }

  return omit(anonymizedGraph, ['encryptionKey']);
}

async function anonymizeRole(
  role,
  viewer, // user or audience like {'@type': 'Audience', 'audienceType': 'public'} or role
  {
    now,
    store,
    fromCache,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    correlatedRoleIds,
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  const isNodeOfId = getId(role.isNodeOf);

  // we only blind Graph roles
  if (
    !isNodeOfId ||
    !isNodeOfId.startsWith('graph:') ||
    !(
      role.roleName === 'author' ||
      role.roleName === 'reviewer' ||
      role.roleName === 'editor' ||
      role.roleName === 'producer'
    )
  ) {
    return role;
  }

  const scopeId = getScopeId(isNodeOfId);
  const graph = await this.get(scopeId, {
    store,
    fromCache,
    acl: false
  });

  const visibleRoleNames = getVisibleRoleNames(viewer, graph, {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection
  });

  const roleProp = role.roleName;

  return maybeAnonymizeRole(
    role,
    viewer,
    visibleRoleNames,
    roleProp,
    graph.encryptionKey,
    { correlatedRoleIds }
  );
}

function createAnonymizedUser(user, anonymizedId) {
  return user && user['@type']
    ? {
        '@id': anonymizedId,
        '@type': user['@type']
      }
    : anonymizedId;
}

/**
 * This is used to get safe user @id for graphs and graph actions
 * We need to generate different value per role to prevent leakage
 */
function maybeAnonymizeRole(
  role, // a `Graph` role
  viewer,
  visibleRoleNames,
  roleProp,
  secret, // graph.encryptionKey
  {
    correlatedRoleIds // when set to `true` the roleId and isNodeOf of Graph role will be removed (this is typically the case when calling `getUserRoles`)
  } = {}
) {
  if (typeof roleProp !== 'string') {
    throw createError(500, `Invalid parameter roleProp for anonymizeRole`);
  }

  if (!secret) {
    throw createError(500, `Invalid parameter secret for anonymizeRole`);
  }

  const user = getAgent(role);
  const sensitiveId = getId(user) || user.email;
  // no sensitiveId => no need for anonymization
  if (
    !correlatedRoleIds &&
    (!sensitiveId ||
      (!sensitiveId.startsWith('user:') &&
        !sensitiveId.startsWith('mailto:')) ||
      !role.roleName)
  ) {
    return role;
  }

  // open peer review => no need for anonymization
  if (
    visibleRoleNames.has('author') &&
    visibleRoleNames.has('reviewer') &&
    visibleRoleNames.has('editor') &&
    visibleRoleNames.has('producer')
  ) {
    return role;
  }

  // we need to anonymize or sameAs
  const { userId: viewerUserId, roleId: viewerRoleId } = parseRoleIds(viewer);

  let { userId, roleId } = parseRoleIds(role);
  if (!roleId) {
    // probably a `srole`
    roleId = getSourceRoleId(role);
  }

  const anonId = `anon:${crypto
    .createHash('sha256')
    .update(encrypt(`${role.roleName}:${unprefix(sensitiveId)}`, secret))
    .digest('hex')}`;

  if (
    visibleRoleNames.has(role.roleName) ||
    (userId && userId === viewerUserId) ||
    (roleId && roleId === viewerRoleId)
  ) {
    // just sameAs
    return Object.assign({}, role, {
      [roleProp]: Object.assign({}, nodeify(role[roleProp]), {
        sameAs: arrayify(role[roleProp].sameAs)
          .filter(uri => getId(uri) !== anonId)
          .concat(anonId)
      })
    });
  } else {
    // anonymize
    const anonymized = Object.assign(omit(role, SENSITIVE_PROPS), {
      [roleProp]: createAnonymizedUser(user, anonId)
    });

    if (correlatedRoleIds) {
      delete anonymized['@id'];
      delete anonymized[roleProp];
      const isNodeOfId = getId(anonymized.isNodeOf);
      if (isNodeOfId && isNodeOfId.startsWith('graph:')) {
        anonymized.isNodeOf = Object.assign(
          { '@type': 'Graph' },
          omit(nodeify(anonymized.isNodeOf), ['@id'])
        );
      }
    }

    return anonymized;
  }
}
