import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import addCallbackSupport from '../utils/add-callback-support';

const WORKFLOW_ACTION_TYPES = new Set([
  'CreateReleaseAction',
  'DeclareAction',
  'ReviewAction',
  'PayAction',
  'TypesettingAction',
  'AssessAction',
  'PublishAction'
]);

/**
 * Make sure that only 1 operation on a given workflow action can be executed at a time:
 * operations: perform, cancel, invite with a purpose, endorse, reschedule, assign, unassign
 * Note: because of polyton action, we use the templateId (within a stageId) to create lock keys
 * => only 1 polyton action of a given template can be performed at a time.
 * This allows to have simple code to guarantee that we don't cancel more action than necessary
 * or assign the same user to different instance of a same template
 */
export default async function createWorkflowActionLock(
  action,
  { store, triggered, now = new Date().toISOString() } = {}
) {
  if (triggered) {
    return;
  }

  const keys = new Set();

  switch (action['@type']) {
    case 'ScheduleAction':
    case 'AssignAction':
    case 'UnassignAction':
    case 'CancelAction':
    case 'EndorseAction': {
      const object = await this.get(getObjectId(action), { acl: false, store });

      if (WORKFLOW_ACTION_TYPES.has(object['@type'])) {
        keys.add(createLockKey(object));
      }
      break;
    }

    case 'InviteAction': {
      if (!action.purpose) {
        return;
      }
      const purposes = await this.get(arrayify(action.purpose), {
        acl: false,
        store
      });
      purposes.forEach(purpose => {
        if (WORKFLOW_ACTION_TYPES.has(purpose['@type'])) {
          keys.add(createLockKey(purpose));
        }
      });
      break;
    }

    default: {
      if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
        keys.add(createLockKey(action));
      }
    }
  }

  const locks = [];
  const errors = [];
  for (const key of keys) {
    try {
      const lock = await this.createLock(key, {
        isLocked: null,
        prefix: 'workflow-action'
      });
      locks.push(lock);
    } catch (err) {
      errors.push(err);
    }
  }

  if (errors.length) {
    await Promise.all(locks.map(lock => lock.unlock()));

    throw createError(
      423,
      errors
        .map(err => err.message)
        .filter(Boolean)
        .join()
    );
  }

  return {
    unlock: addCallbackSupport(() => {
      return Promise.all(locks.map(lock => lock.unlock()));
    })
  };
}

function createLockKey(workflowAction) {
  const stageId = getId(workflowAction.resultOf);
  const templateId = getId(workflowAction.instanceOf);
  return `${stageId}:${templateId}`;
}
