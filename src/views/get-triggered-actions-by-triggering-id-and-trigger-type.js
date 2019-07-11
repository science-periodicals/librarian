import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getTriggeredActionsByTriggeringIdAndTriggerType(
  keys, // list of [triggerringId, triggerType]
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.view.post(
    {
      url: '/triggeredActionsByTriggeringIdAndTriggerType',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: { keys }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        this.log.error(
          { err, keys },
          'error in getTriggeredActionsByTriggeringIdAndTriggerType'
        );
        return callback(err);
      }

      let payload = getDocs(body);

      if (store) {
        // Because of CouchDB 2.0 clustering the view may be out of date and
        // miss the triggered action. We try to mitigate that here as in theory the
        // triggering action handler could only complete if it was able to fetch
        // the data that this view would return => the triggered action should all be
        // in the `store`
        store.add(payload);

        const docs = store.getAll();

        // Build an index using the exact same logic as the couchDB view
        const index = docs.reduce((index, doc) => {
          if (doc._id) {
            var [, type] = parseIndexableString(doc._id);
            if (type === 'action') {
              // OnObjectActiveActionStatus, OnObjectStagedActionStatus, OnObjectCompletedActionStatus, OnObjectFailedActionStatus
              if (doc.object) {
                let object = doc.object.object || doc.object;
                if (Array.isArray(object)) {
                  object = object[0];
                }

                if (object) {
                  const objectId = getId(object);
                  if (typeof objectId === 'string') {
                    [
                      'OnObjectActiveActionStatus',
                      'OnObjectStagedActionStatus',
                      'OnObjectCompletedActionStatus',
                      'OnObjectFailedActionStatus'
                    ].forEach(triggerType => {
                      if (
                        doc.activateOn === triggerType ||
                        doc.completeOn === triggerType
                      ) {
                        const key = `${objectId}-${triggerType}`;
                        index[key] = index[key] || [];
                        index[key].push(doc);
                      }
                    });
                  }
                }
              }

              // OnWorkflowStageEnd
              if (doc.resultOf) {
                const resultOfId = getId(doc.resultOf);
                if (typeof resultOfId === 'string') {
                  ['OnWorkflowStageEnd'].forEach(triggerType => {
                    if (
                      doc.activateOn === triggerType ||
                      doc.completeOn === triggerType
                    ) {
                      const key = `${resultOfId}-${triggerType}`;
                      index[key] = index[key] || [];
                      index[key].push(doc);
                    }
                  });
                }
              }

              // OnWorkerEnd (only used with UploadAction), OnEndorsed
              if (getId(doc)) {
                const actionId = getId(doc);
                if (typeof actionId === 'string') {
                  ['OnWorkerEnd', 'OnEndorsed'].forEach(triggerType => {
                    if (
                      doc.activateOn === triggerType ||
                      doc.endorseOn === triggerType ||
                      doc.completeOn === triggerType
                    ) {
                      const key = `${actionId}-${triggerType}`;
                      index[key] = index[key] || [];
                      index[key].push(doc);
                    }
                  });
                }
              }
            }
          }

          return index;
        }, {});

        const triggeredActions = [];
        keys.forEach(keyList => {
          const key = `${keyList[0]}-${keyList[1]}`;
          if (key in index) {
            const indexed = index[key];
            indexed.forEach(triggeredAction => {
              if (
                !triggeredActions.some(
                  action => getId(action) === getId(triggeredAction)
                )
              ) {
                triggeredActions.push(triggeredAction);
              }
            });
          }
        });

        payload = triggeredActions;
      }

      callback(null, payload);
    }
  );
}
