import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getBlockedActionsByBlockingActionIdsAndStageId(
  blockingActionIds,
  stageId,
  { store } = {},
  callback
) {
  stageId = getId(stageId);
  blockingActionIds = new Set(
    arrayify(blockingActionIds)
      .map(blockingActionId => getId(blockingActionId))
      .filter(Boolean)
  );

  this.view.get(
    {
      url: '/actionByStageIdAndTemplateId',
      qs: {
        reduce: false,
        include_docs: true,
        startkey: JSON.stringify([stageId, '']),
        endkey: JSON.stringify([stageId, '\ufff0'])
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const actions = getDocs(body);
      const blockedActions = actions.filter(
        action =>
          action.actionStatus !== 'CompletedActionStatus' &&
          arrayify(action.requiresCompletionOf).some(action =>
            blockingActionIds.has(getId(action))
          )
      );

      callback(null, blockedActions);
    }
  );
}
