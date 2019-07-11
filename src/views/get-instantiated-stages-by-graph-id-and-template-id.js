import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import { getDocs } from '../low';
import { getTemplateId } from '../utils/workflow-actions';
import { getStageActions } from '../utils/workflow-utils';

/**
 * `templateId` is the @id of an action listed in a WorkflowSpecification
 */
export default function getInstantiatedStagesByGraphIdAndTemplateId(
  graphId, // live graph @id
  templateId,
  { store } = {},
  callback
) {
  graphId = getScopeId(graphId);
  templateId = getId(templateId);

  this.view.get(
    {
      url: '/instantiatedStagesByGraphIdAndTemplateId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify([graphId, templateId])
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      // Because of CouchDB 2.0 clustering the view may be out of date and
      // miss some recent actions. We try to mitigate that here by recomputing
      // the view from data from the store

      let payload = getDocs(body);

      if (store) {
        // add current payload to store first
        store.add(payload);
        // reconstruct the payload from the store that may have more data
        payload = store.getAll().filter(doc => {
          if (
            getScopeId(doc) === graphId &&
            doc['@type'] === 'StartWorkflowStageAction'
          ) {
            const stageActions = getStageActions(doc);
            if (
              stageActions.some(action => getTemplateId(action) === templateId)
            ) {
              return true;
            }

            // no stage action? it may be an InformAction or an EmailMessage of an AssessAction
            const assessAction = stageActions.find(
              action => action['@type'] === 'AssessAction'
            );
            if (assessAction) {
              for (const action of arrayify(assessAction.potentialAction)) {
                if (getTemplateId(action) === templateId) {
                  return true;
                }
                for (const instrument of arrayify(action.instrument)) {
                  if (getTemplateId(instrument) === templateId) {
                    return true;
                  }
                }
              }
            }
          }

          return false;
        });
      }

      callback(null, payload);
    }
  );
}
