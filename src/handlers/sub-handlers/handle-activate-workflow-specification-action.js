import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../../create-id';
import handleParticipants from '../../utils/handle-participants';
import getScopeId from '../../utils/get-scope-id';
import setId from '../../utils/set-id';

export default async function handleActivateWorkflowSpecificationAction(
  action,
  workflowSpecification,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (
    workflowSpecification.workflowSpecificationStatus == null ||
    workflowSpecification.workflowSpecificationStatus ===
      'DeactivatedWorkflowSpecificationStatus'
  ) {
    const scopeId = getScopeId(workflowSpecification);
    const scope = await this.get(scopeId, {
      store,
      acl: false
    });

    const handledWorkflowSpecification = Object.assign(
      {},
      workflowSpecification,
      {
        workflowSpecificationStatus: 'ActiveWorkflowSpecificationStatus'
      }
    );

    const handledAction = setId(
      handleParticipants(
        Object.assign(
          {
            startTime: new Date().toISOString()
          },
          action,
          {
            endTime: new Date().toISOString(),
            result: getId(workflowSpecification)
          }
        ),
        scope
      ),
      createId('action', action, scope)
    );

    const [savedAction, savedWorkflowSpecification] = await this.put(
      [handledAction, handledWorkflowSpecification],
      {
        store,
        force: true
      }
    );

    return Object.assign({}, savedAction, {
      result: savedWorkflowSpecification
    });
  }

  // no op
  return action;
}
