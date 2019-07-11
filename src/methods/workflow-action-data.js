import uniq from 'lodash/uniq';
import createError from '@scipe/create-error';
import { arrayify, getId } from '@scipe/jsonld';
import { parseIndexableString } from '@scipe/collate';
import { getDbName } from '../low';
import getScopeId from '../utils/get-scope-id';

// These methods are here to workaround the clustered nature and eventual
// consistancy of CouchDB 2.x where we don't have the guarantee to GET all the
// documents stored in the DB (the node we query may be lagging.
//
// We work around that by keeping track of a set of all the document that should
// be present for a given scopeId.
// This is hooked up with librarian#put

/**
 * This is called by librarian#put to keep the Redis Set up to date
 */
export function syncWorkflowActionDataSummary(docs, callback) {
  const prefix = `${getDbName(this.config)}:wid`;

  const addedValues = new Set();
  const removedValues = new Set();
  const deletedKeys = new Set();

  for (const doc of arrayify(docs)) {
    if (
      doc['@type'] === 'Graph' &&
      doc.version == null &&
      (doc._deleted || doc.datePublished || doc.dateRejected)
    ) {
      deletedKeys.add(`${prefix}:${getScopeId(doc)}`);
    }

    const [scopeId, type, id] = parseIndexableString(doc._id);
    if (scopeId.startsWith('graph:') && type === 'action' && id) {
      if (doc._deleted) {
        removedValues.add(stringify(doc));
      } else {
        addedValues.add(stringify(doc));
      }
    }
  }

  const cmds = Array.from(addedValues)
    .map(value => {
      return [
        'sadd',
        `${prefix}:${parseIndexableString(parse(value)._id)[0]}`,
        value
      ];
    })
    .concat(
      Array.from(removedValues).map(value => {
        return [
          'srem',
          `${prefix}:${parseIndexableString(parse(value)._id)[0]}`,
          value
        ];
      }),
      Array.from(deletedKeys).map(key => {
        return ['del', key];
      })
    );

  this.redis.multi(cmds).exec(callback);
}

function stringify(doc) {
  return [
    doc._id,
    doc['@type'] || 'Action',
    doc.actionStatus || 'PotentialActionStatus'
  ].join('#');
}

function parse(key) {
  const [_id, type, actionStatus] = key.split('#');
  return {
    _id,
    '@type': type,
    actionStatus
  };
}

export function getWorkflowActionDataSummary(scopeId, callback) {
  const prefix = `${getDbName(this.config)}:wid`;
  // Note this return [] if key no longer exists
  this.redis.smembers(`${prefix}:${getScopeId(scopeId)}`, (err, data) => {
    if (err) {
      return callback(err);
    }

    callback(
      null,
      data.map(value => {
        return parse(value);
      })
    );
  });
}

export function hasOutdatedStateMachineStatus(action = {}, knownStatuses = []) {
  knownStatuses = arrayify(knownStatuses).filter(Boolean);
  // Note: we never include `FailedActionStatus` to allow for retries
  switch (action.actionStatus) {
    case 'PotentialActionStatus':
      return knownStatuses.some(
        status =>
          status === 'ActiveActionStatus' ||
          status === 'StagedActionStatus' ||
          status === 'EndorsedActionStatus' ||
          status === 'CompletedActionStatus' ||
          status === 'CanceledActionStatus'
      );

    case 'ActiveActionStatus':
      return knownStatuses.some(
        status =>
          status === 'StagedActionStatus' ||
          status === 'EndorsedActionStatus' ||
          status === 'CompletedActionStatus' ||
          status === 'CanceledActionStatus'
      );

    case 'StagedActionStatus':
      return knownStatuses.some(
        status =>
          status === 'EndorsedActionStatus' ||
          status === 'CompletedActionStatus' ||
          status === 'CanceledActionStatus'
      );

    case 'EndorsedActionStatus':
      return knownStatuses.some(
        status =>
          status === 'CompletedActionStatus' ||
          status === 'CanceledActionStatus'
      );

    case 'FailedActionStatus':
    case 'CompletedActionStatus':
      return false;

    case 'CanceledActionStatus':
      return knownStatuses.some(status => status === 'CompletedActionStatus');

    default:
      throw createError(
        500,
        `Invalid action status (${action.actionStatus}) for ${getId(action)} (${
          action['@type']
        })`
      );
  }
}

export async function ensureAllWorkflowActionsStateMachineStatus(
  scopeId,
  { store }
) {
  const summary = await this.getWorkflowActionDataSummary(getScopeId(scopeId));
  const _ids = uniq(summary.map(value => value._id));

  let actions;
  try {
    actions = await this.get(_ids, { acl: false, store, needAll: true });
  } catch (err) {
    if (err.code === 404) {
      throw createError(
        503,
        `All the documents required to handle ${scopeId} haven't been replicated to the server yet, please try again later. Details: ${err.code} ${err.message}`
      );
    }

    throw err;
  }

  // Be sure that the fetched action has an actionStatus more advanced than the most advanced one of the summary
  const outdatedMsgs = [];
  actions.forEach(action => {
    const knownStatuses = summary
      .filter(value => value._id === action._id)
      .map(value => value.actionStatus);

    const isOutdated = hasOutdatedStateMachineStatus(action, knownStatuses);

    if (isOutdated) {
      outdatedMsgs.push(
        `${getId(action)} (${action['@type']}) status: ${
          action.actionStatus
        }, known statuses: ${knownStatuses.join(', ')}`
      );
    }
  });

  if (outdatedMsgs.length) {
    throw createError(
      503,
      `All the documents required to handle ${scopeId} haven't been replicated to the server yet, please try again later ${outdatedMsgs.join(
        ' '
      )}`
    );
  }
}

export async function ensureWorkflowActionStateMachineStatus(
  actionId,
  { store }
) {
  const action = await this.get(getId(actionId), { acl: false, store });
  const [scopeId, type] = parseIndexableString(action._id);
  if (type === 'action' && scopeId && scopeId.startsWith('graph:')) {
    const summary = await this.getWorkflowActionDataSummary(getScopeId(action));

    // Be sure that the fetched action has an actionStatus more advanced than the most advanced one of the summary
    const knownStatuses = summary
      .filter(value => value._id === action._id)
      .map(value => value.actionStatus);

    const isOutdated = hasOutdatedStateMachineStatus(action, knownStatuses);

    if (isOutdated) {
      throw createError(
        503,
        `${getId(action)} (${action['@type']}) is outdated status: ${
          action.actionStatus
        }, known statuses: ${knownStatuses.join(', ')}`
      );
    }
  }
}
