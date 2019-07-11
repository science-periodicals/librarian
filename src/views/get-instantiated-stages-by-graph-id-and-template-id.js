import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import { getDocs } from '../low';

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

      callback(null, getDocs(body));
    }
  );
}
