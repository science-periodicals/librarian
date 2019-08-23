import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import { WEBIFY_ACTION_TYPES, ERROR_CODE_TRIGGERED_ACTION } from '../constants';

/**
 * Implemented triggers:
 * `activateOn`:
 * used for:
 * - `EndorseAction` (activateOn: `OnObjectStagedActionStatus`)
 *
 * `endorseOn`:
 * used for:
 * - `PayAction` (endorseOn: `OnEndorsed`)
 *
 * `completeOn`:
 * used for:
 * - `CommentAction` (completeOn: `OnObjectCompletedActionStatus`)
 * - `AuthorizeAction` (completeOn: `OnObjectStagedActionStatus`,  `OnObjectCompletedActionStatus` and `OnWorkflowStageEnd`)
 * - Endorsed workflow action (ReviewAction etc.) (completeOn: `OnEndorsed`)
 * - `UploadAction` (completeOn: `OnWorkerEnd`)
 *
 * see https://www.youtube.com/watch?v=xDuwrtwYHu8 for a great talk on saga
 * (saga could provide an alternative implementation)
 */
export default async function handleTriggers(
  action, // the triggering action
  { store, strict, triggeredActionTypes } = {}
) {
  // Note `valueRequiredOn` and associated `OnPublicationAccepted` is only used for validation
  // => we only care about `activeOn` and `completeOn` here

  // we collect the keys for the triggeredActionsByTriggeringIdAndTriggerType CouchDB view
  const keys = [];

  // An action can be the object of another action and triggers
  // `OnObjectActiveActionStatus` | `OnObjectCompletedActionStatus` |
  // `OnObjectStagedActionStatus` | `OnObjectFailedActionStatus`
  if (
    action.actionStatus === 'ActiveActionStatus' ||
    action.actionStatus === 'FailedActionStatus'
  ) {
    keys.push([getId(action), `OnObject${action.actionStatus}`]);
  } else if (action.actionStatus === 'StagedActionStatus') {
    // we also trigger the previous triggers in case when user fast forwarded
    keys.push([getId(action), 'OnObjectActiveActionStatus']);
    keys.push([getId(action), `OnObject${action.actionStatus}`]);
  } else if (action.actionStatus === 'CompletedActionStatus') {
    // we also trigger the previous triggers in case when user fast forwarded
    keys.push([getId(action), 'OnObjectActiveActionStatus']);
    keys.push([getId(action), 'OnObjectStagedActionStatus']);
    keys.push([getId(action), `OnObject${action.actionStatus}`]);
  }

  // Completed `AssessAction` or `PublishAction` trigger `OnWorkflowStageEnd`
  // TODO handle AbortAction as well for workflow abortion
  if (
    action.actionStatus === 'CompletedActionStatus' &&
    (action['@type'] === 'AssessAction' ||
      action['@type'] === 'PublishAction') &&
    getId(action.resultOf) // stageId
  ) {
    keys.push([getId(action.resultOf), 'OnWorkflowStageEnd']);
  }

  // Completed `WebifyAction` triggers OnWorkerEnd
  if (
    WEBIFY_ACTION_TYPES.has(action['@type']) &&
    (action.actionStatus === 'CompletedActionStatus' ||
      action.actionStatus === 'FailedActionStatus') &&
    getId(action.instrumentOf) // uploadActionId
  ) {
    keys.push([getId(action.instrumentOf), 'OnWorkerEnd']);
  }

  // Completed `EndorseAction` _may_ triggers OnEndorsed (further validation is
  // done below)
  if (
    action.actionStatus === 'CompletedActionStatus' &&
    action['@type'] === 'EndorseAction' &&
    getId(action) &&
    getObjectId(action)
  ) {
    keys.push([getObjectId(action), `OnEndorsed`]);
  }

  let triggeredActions = (await this.getTriggeredActionsByTriggeringIdAndTriggerType(
    keys,
    { store }
  )).sort((a, b) => {
    // Auhtorize / deauthorize first
    if (
      (a['@type'] === 'AuthorizeAction' ||
        a['@type'] === 'DeauthorizeAction') &&
      !(b['@type'] === 'AuthorizeAction' || b['@type'] === 'DeauthorizeAction')
    ) {
      return -1;
    }

    // InformAction last
    if (a['@type'] === 'InformAction' && b['@type'] !== 'InformAction') {
      return 1;
    }
  });

  if (arrayify(triggeredActionTypes).filter(Boolean).length) {
    triggeredActions = triggeredActions.filter(action => {
      return arrayify(triggeredActionTypes).some(
        type => action['@type'] === type
      );
    });
  }

  const handledTriggeredActions = [];
  const errors = [];
  for (const triggeredAction of triggeredActions) {
    let handledTriggeredAction, triggerType;
    // triggeredAction was triggered by activateOn, endorseOn or completeOn

    if (triggeredAction.completeOn) {
      triggerType = triggeredAction.completeOn;
      const triggerId = getTriggerId(triggeredAction, triggerType);
      if (keys.some(key => key[0] === triggerId && key[1] === triggerType)) {
        // Do not trigger if triggeredAction requiresCompletionOf
        if (triggeredAction.requiresCompletionOf) {
          let blockingActions;
          try {
            blockingActions = await this.get(
              arrayify(triggeredAction.requiresCompletionOf),
              {
                store,
                acl: false
              }
            );
          } catch (err) {
            if (err.code !== 404) {
              throw err;
            }
          }
          const incompleteBlockingActions = arrayify(blockingActions).filter(
            action =>
              action.actionStatus !== 'CompletedActionStatus' &&
              action.actionStatus !== 'CanceledActionStatus'
          );

          this.log.debug(
            { action, blockingActions },
            'librarian.handleTriggers completeOn trigger, check blocking actions'
          );

          if (incompleteBlockingActions.length) {
            continue;
          }
        }

        handledTriggeredAction = Object.assign(
          omit(triggeredAction, ['completeOn', 'endorseOn', 'activateOn']), // we make sure that we kill `activateOn` and `endorseOn` as `completeOn` wins
          { actionStatus: 'CompletedActionStatus' }
        );
      } else {
        continue;
      }
    } else if (triggeredAction.endorseOn) {
      triggerType = triggeredAction.endorseOn;
      const triggerId = getTriggerId(triggeredAction, triggerType);
      if (keys.some(key => key[0] === triggerId && key[1] === triggerType)) {
        // Do not trigger if triggeredAction requiresCompletionOf
        if (triggeredAction.requiresCompletionOf) {
          let blockingActions;
          try {
            blockingActions = await this.get(
              arrayify(triggeredAction.requiresCompletionOf),
              {
                store,
                acl: false
              }
            );
          } catch (err) {
            if (err.code !== 404) {
              throw err;
            }
          }
          const incompleteBlockingActions = arrayify(blockingActions).filter(
            action =>
              action.actionStatus !== 'CompletedActionStatus' &&
              action.actionStatus !== 'CanceledActionStatus'
          );
          if (incompleteBlockingActions.length) {
            continue;
          }
        }

        handledTriggeredAction = Object.assign(
          omit(triggeredAction, ['endorseOn', 'activateOn']), // we make sure that we kill `activateOn` as `endorseOn` wins
          { actionStatus: 'EndorsedActionStatus' }
        );
      } else {
        continue;
      }
    } else if (triggeredAction.activateOn) {
      triggerType = triggeredAction.activateOn;
      const triggerId = getTriggerId(triggeredAction, triggerType);

      if (keys.some(key => key[0] === triggerId && key[1] === triggerType)) {
        handledTriggeredAction = Object.assign(
          omit(triggeredAction, ['activateOn']),
          { actionStatus: 'ActiveActionStatus' }
        );
      } else {
        continue;
      }
    } else {
      continue;
    }

    try {
      const postedTriggeredAction = await this.post(handledTriggeredAction, {
        store,
        strict,
        acl: false,
        triggered: true,
        triggerType
      });
      handledTriggeredActions.push(postedTriggeredAction);
    } catch (err) {
      this.log.error(
        { err, action, handledTriggeredAction },
        'error posting triggered action'
      );
      errors.push(err);
    }
  }

  this.log.debug(
    { action, keys, triggeredActions, handledTriggeredActions },
    'librarian.handleTriggers'
  );

  if (errors.length) {
    throw createError(
      ERROR_CODE_TRIGGERED_ACTION,
      `Error in triggered actions triggered by ${getId(action)} (${
        action['@type']
      }). ` + errors.map(err => `${err.code} - ${err.message}`).join(' ; ')
    );
  }

  return handledTriggeredActions;
}

function getTriggerId(triggeredAction, triggerType) {
  switch (triggerType) {
    case 'OnObjectActiveActionStatus':
    case 'OnObjectStagedActionStatus':
    case 'OnObjectCompletedActionStatus':
    case 'OnObjectFailedActionStatus': {
      return getObjectId(triggeredAction);
    }

    case 'OnWorkflowStageEnd':
      return getId(triggeredAction.resultOf);

    case 'OnWorkerEnd':
    case 'OnEndorsed':
      return getId(triggeredAction);
    default:
      return;
  }
}
