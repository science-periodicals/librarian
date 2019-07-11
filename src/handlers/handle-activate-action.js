import createError from '@scipe/create-error';
import handleActivateServiceAction from './sub-handlers/handle-activate-service-action';
import handleActivateWorkflowSpecificationAction from './sub-handlers/handle-activate-workflow-specification-action';
import handleActivatePublicationTypeAction from './sub-handlers/handle-activate-publication-type-action';
import { getObjectId } from '../utils/schema-utils';

export default async function handleActivateAction(
  action,
  { store, triggered, prevAction } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be a defined`);
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });

  switch (object['@type']) {
    case 'Service':
      return handleActivateServiceAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    case 'WorkflowSpecification':
      return handleActivateWorkflowSpecificationAction.call(
        this,
        action,
        object,
        { store, triggered, prevAction }
      );

    case 'PublicationType':
      return handleActivatePublicationTypeAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    default:
      throw createError(400, `invalid object for ${action['@type']}`);
  }
}
