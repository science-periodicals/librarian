import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';
import { validateAndSetupWorkflowSpecification } from '../utils/workflow-actions';
import handleParticipants from '../utils/handle-participants';
import setId from '../utils/set-id';
import { getObjectId } from '../utils/schema-utils';

export default async function handleCreateWorfklowSpecificationAction(
  action,
  { store, triggered, prevAction } = {}
) {
  const periodical = await this.get(getObjectId(action), {
    store,
    acl: false
  });

  if (periodical['@type'] !== 'Periodical') {
    throw createError(
      403,
      `Invalid CreateWorkflowSpecificationAction, the object must point to a Periodical`
    );
  }

  const workflowSpecification = action.result;
  if (!workflowSpecification) {
    throw createError(
      400,
      'Invalid CreateWorkflowSpecificationAction, CreateWorkflowSpecificationAction needs to have a result'
    );
  }

  const validatedWorkflowSpecification = await validateAndSetupWorkflowSpecification(
    workflowSpecification,
    periodical
  );

  // TODO use this.update
  const updatedPeriodical = Object.assign({}, periodical, {
    potentialWorkflow: arrayify(periodical.potentialWorkflow)
      .filter(
        potentialWorkflow =>
          getId(potentialWorkflow) !== getId(validatedWorkflowSpecification)
      )
      .concat(getId(validatedWorkflowSpecification))
  });

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          startTime: new Date().toISOString()
        },
        action,
        {
          actionStatus: 'CompletedActionStatus',
          endTime: new Date().toISOString(),
          result: getId(validatedWorkflowSpecification)
        }
      ),
      periodical
    ),
    createId('action', action, periodical)
  );

  const [
    savedAction,
    savedPeriodical,
    savedValidatedWorkflowSpecification
  ] = await this.put(
    [handledAction, updatedPeriodical, validatedWorkflowSpecification],
    {
      acl: false,
      force: true,
      store
    }
  );

  return Object.assign({}, savedAction, {
    result: savedValidatedWorkflowSpecification
  });
}
