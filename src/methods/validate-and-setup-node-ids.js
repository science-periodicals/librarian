import traverse from 'traverse';
import isPlainObject from 'lodash/isPlainObject';
import createError from '@scipe/create-error';
import { arrayify, getId, reUuidBlankNode } from '@scipe/jsonld';
import {
  getResultId,
  getResult,
  getObjectId,
  getTargetCollectionId
} from '../utils/schema-utils';
import schema from '../utils/schema';
import createId from '../create-id';
import { WEBIFY_ACTION_TYPES } from '../constants';

/**
 * Setup:
 * - Upgrade blank node @id with isNodeOf === getId(prevEmbedderDoc) to `node:`
 * - upgraded non uuid blank nodes to uuid blank nodes
 *
 * Validation:
 * All the nodes with `node:` + isNodeOf === getId(prevEmbedderDoc) of `obj`
 * must exist in `prevEmbedderDoc` or a completed UploadAction
 *
 * Call for create / update of:
 * - Graph
 * - release (so CreateReleaseAction & PublishAction)
 * - Periodical
 * - Issue & SpecialIssue
 */
export default async function validateAndSetupNodeIds(
  data, // Typically `result` of a `CreateAction` or an `UpdateAction`. !!When it's the `result` of a `CreateAction` the @id must be present
  { store, strict = true, prevEmbedderDoc = {} } = {}
) {
  let nodesSource, embedderDocId;

  // Validation:
  // For stories (or if `data` is an update payload from a worker) we don't
  // validate so that we can directly set the `node:` @id

  // Early returns: the update payload can be "trusted":
  // =>  it is coming from an `UploadAction` or a `WebifyAction`
  if (data['@type'] === 'UpdateAction') {
    const updateAction = data;
    const objectId = getObjectId(updateAction);
    const resultOfId = getId(updateAction.resultOf);
    if (objectId && objectId.startsWith('action:')) {
      const uploadAction = await this.get(objectId, { store, acl: false });
      if (uploadAction['@type'] === 'UploadAction') {
        return data;
      }
    }

    if (resultOfId) {
      const resultOf = await this.get(resultOfId, { store, acl: false });
      if (WEBIFY_ACTION_TYPES.has(resultOf['@type'])) {
        return data;
      }
    }

    // Nothing we can do here
    if (!isPlainObject(updateAction.object)) {
      return data;
    }

    nodesSource = data.object;
    embedderDocId = getTargetCollectionId(data);
  } else {
    nodesSource = data;
    embedderDocId = getId(data);
  }

  if (!embedderDocId) {
    throw createError(
      400,
      'validateAndSetupNodeIds, embedderDocId was not provided through data'
    );
  }

  if (strict) {
    const invalidNodeIdMsgs = [];

    const prevNodeMap = getTypedNodeMap(prevEmbedderDoc);

    const nodeMap = getTypedNodeMap(nodesSource);
    const nodes = Object.keys(nodeMap).map(key => nodeMap[key]);

    for (const node of nodes) {
      const nodeId = getId(node);
      if (getId(node.isNodeOf) === getId(prevEmbedderDoc)) {
        let prevNode = prevNodeMap[nodeId];

        if (!prevNode && (schema.is(node, 'MediaObject') || node.contentUrl)) {
          const actions = await this.getActionsByResultId(nodeId, {
            store
          });
          const uploadAction = actions.find(
            action =>
              action['@type'] === 'UploadAction' &&
              getResultId(action) === nodeId &&
              action.actionStatus === 'CompletedActionStatus'
          );
          if (uploadAction) {
            prevNode = getResult(uploadAction);
          }
        }

        if (!prevNode || getId(prevNode.isNodeOf) !== getId(node.isNodeOf)) {
          invalidNodeIdMsgs.push(
            `@id: ${nodeId}, @type: ${node['@type']}, isNodeOf: ${getId(
              node.isNodeOf
            )}, prevNode: ${!!prevNode}, prevIsNodeOf: ${getId(
              prevNode && prevNode.isNodeOf
            )}`
          );
        }
      }
    }

    if (invalidNodeIdMsgs.length) {
      throw createError(
        400,
        `invalid "node:" CURIE: ${invalidNodeIdMsgs.join(' ; ')}`
      );
    }
  }

  // Setup:
  const relabelMap = getRelabelMap(nodesSource, getId(embedderDocId));
  const handledData = traverse.map(nodesSource, function(x) {
    if (typeof x === 'string' && x.startsWith('_:') && x in relabelMap) {
      this.update(relabelMap[x]);
    }
  });

  return data['@type'] === 'UpdateAction'
    ? Object.assign({}, data, { object: handledData })
    : handledData;
}

function getTypedNodeMap(obj, _map = {}) {
  if (isPlainObject(obj)) {
    Object.keys(obj).forEach(key => {
      const values = arrayify(obj[key]);
      values.forEach(value => {
        if (
          key === '@id' &&
          typeof value === 'string' &&
          value.startsWith('node:')
        ) {
          _map[value] = obj;
        } else {
          getTypedNodeMap(value, _map);
        }
      });
    });
  }

  return _map;
}

function getRelabelMap(obj, isNodeOfId, _relabelMap = {}, _mainEntityId) {
  _mainEntityId = _mainEntityId || getId(obj && obj.mainEntity);

  if (isPlainObject(obj)) {
    Object.keys(obj).forEach(key => {
      const values = arrayify(obj[key]);
      values.forEach(value => {
        if (
          key === '@id' &&
          typeof value === 'string' &&
          value.startsWith('_:') &&
          !(value in _relabelMap)
        ) {
          // if mainEntityId is a blank node we also upgrade
          if (
            getId(obj.isNodeOf) === isNodeOfId ||
            (!getId(obj.isNodeOf) && value === _mainEntityId)
          ) {
            _relabelMap[value] = createId('node', null)['@id'];
          } else if (!reUuidBlankNode.test(value)) {
            _relabelMap[value] = createId('blank')['@id'];
          }
        } else {
          getRelabelMap(value, isNodeOfId, _relabelMap, _mainEntityId);
        }
      });
    });
  }

  return _relabelMap;
}
