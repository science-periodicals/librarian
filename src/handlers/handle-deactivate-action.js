import createError from '@scipe/create-error';
import handleDeactivateServiceAction from './sub-handlers/handle-deactivate-service-action';
import handleDeactivateWorkflowSpecificationAction from './sub-handlers/handle-deactivate-workflow-specification-action';
import handleDeactivatePublicationTypeAction from './sub-handlers/handle-deactivate-publication-type-action';
import { getObjectId } from '../utils/schema-utils';

export default async function handleDeactivateAction(
  action,
  { store, triggered, prevAction } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be defined`);
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });

  switch (object['@type']) {
    case 'Service':
      return handleDeactivateServiceAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    case 'WorkflowSpecification':
      return handleDeactivateWorkflowSpecificationAction.call(
        this,
        action,
        object,
        {
          store,
          triggered,
          prevAction
        }
      );

    case 'PublicationType':
      return handleDeactivatePublicationTypeAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    default:
      throw createError(400, `invalid object for ${action['@type']}`);
  }
}
