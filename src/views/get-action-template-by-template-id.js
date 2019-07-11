import once from 'once';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';
import schema from '../utils/schema';
import {
  getFramedGraphTemplate,
  getWorkflowMap
} from '../utils/workflow-actions';

/**
 * Action templates come from WorkflowSpecification or Service
 */
export default function getActionTemplateByTemplateId(
  templateId,
  { store } = {},
  callback
) {
  callback = once(callback);

  templateId = getId(templateId);

  this.view.get(
    {
      url: '/actionTemplateByTemplateId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify(templateId)
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const [parent] = getDocs(body);
      if (!parent) {
        return callback(createError(404, 'Not Found'));
      }

      // `parent` is either a Service or WorkflowSpecification
      if (schema.is(parent, 'Service')) {
        const service = parent;

        // find template within service
        for (const action of arrayify(service.serviceOutput)) {
          if (getId(action) === templateId) {
            return callback(null, action);
          }
          for (const potentialAction of arrayify(action.potentialAction)) {
            if (getId(potentialAction) === templateId) {
              return callback(null, potentialAction);
            }
          }
        }

        callback(createError(404, 'Not Found'));
      } else {
        // WorkflowSpecification
        const workflowSpecification = parent;
        getFramedGraphTemplate(workflowSpecification)
          .then(framedGraphTemplate => {
            const workflowMap = getWorkflowMap(framedGraphTemplate);

            const template = workflowMap[templateId];
            if (!template) {
              return callback(createError(404, 'Not Found'));
            }
            callback(null, template);
          })
          .catch(callback);
      }
    }
  );
}
