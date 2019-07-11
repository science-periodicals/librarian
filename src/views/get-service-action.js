import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getServiceAction(serviceActionId, callback) {
  serviceActionId = getId(serviceActionId);

  this.view.get(
    {
      url: '/createWorkflowStageActionByServiceActionId',
      qs: {
        key: JSON.stringify(serviceActionId),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const stage = getDocs(body)[0];

      let serviceAction;
      const results = arrayify(stage && stage.result);
      for (const result of results) {
        const nodes = arrayify(
          result.object && result.object['@graph-input']
        ).concat(arrayify(result.result && result.result['@graph-output']));
        for (const node of nodes) {
          const potentialActions = arrayify(node.potentialAction);
          for (const action of potentialActions) {
            if (getId(action) === serviceActionId) {
              serviceAction = action;
              break;
            }
          }
        }
      }

      if (!serviceAction) {
        return createError(
          404,
          `Could not find CreateWorkflowAction embedding service action ${serviceActionId}`
        );
      }

      callback(null, serviceAction);
    }
  );
}
