import { getId, arrayify } from '@scipe/jsonld';
import {
  ERROR_CODE_POTENTIAL_INFORM_ACTION,
  ERROR_CODE_POTENTIAL_INFORM_ACTION_FATAL
} from '../constants';

/**
 * Note: this should not error in case where librarian.post fails as we
 * persist the error. This is so that main this.post (calling that method)
 * don't fail (the errored potential InformAction will be returned as
 * potential actions
 */
export default async function handlePotentialInformActions(
  actions, // a list of potential `InformAction`
  object, // the action to which the `InformAction` is potentialAction
  {
    acl,
    triggered,
    store,
    strict,
    referer // comes from req.headers.referer (from the API)
  }
) {
  const handledActions = [];
  for (const action of arrayify(actions)) {
    let handledAction;
    try {
      handledAction = await this.post(action, {
        strict,
        acl,
        triggered,
        store,
        referer
      });
      handledActions.push(handledAction);
    } catch (err) {
      this.log.error(
        { err, action, object },
        'error during handlePotentialInformActions'
      );
      // try to repost as `FailedActionStatus`
      const failedAction = Object.assign({}, action, {
        actionStatus: 'FailedActionStatus',
        error: {
          '@type': 'Error',
          name: `Potential inform action error following ${getId(object)} (${
            object['@type']
          })`,
          statusCode: ERROR_CODE_POTENTIAL_INFORM_ACTION,
          description: err.message
        }
      });
      try {
        handledAction = await this.post(failedAction, {
          strict,
          acl,
          triggered,
          store,
          referer
        });
        handledActions.push(handledAction);
      } catch (err) {
        const refailedAction = Object.assign({}, failedAction, {
          error: [
            failedAction.error,
            {
              '@type': 'Error',
              name: `Potential inform action error following ${getId(
                object
              )} (${object['@type']})`,
              statusCode: ERROR_CODE_POTENTIAL_INFORM_ACTION_FATAL,
              description: err.message
            }
          ]
        });
        handledActions.push(refailedAction);
        this.log.fatal(
          { err, action, object },
          `Could not mark potential inform action as failed`
        );
      }
    }
  }

  return handledActions;
}
