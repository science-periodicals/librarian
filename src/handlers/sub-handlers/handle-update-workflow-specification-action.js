import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { validateOverwriteUpdate } from '../../validators';
import getScopeId from '../../utils/get-scope-id';
import { validateAndSetupWorkflowSpecification } from '../../utils/workflow-actions';

export default async function handleUpdateWorkflowSpecificationAction(
  action,
  workflowSpecification,
  { store, triggered, prevAction }
) {
  const periodicalId = getScopeId(workflowSpecification);
  const periodical = await this.get(periodicalId, {
    store,
    acl: false
  });

  const messages = validateOverwriteUpdate(
    workflowSpecification,
    action.object,
    action.targetCollection.hasSelector,
    {
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'dateCreated',
        'workflowSpecificationStatus'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedWorkflowSpecification = await this.update(
        workflowSpecification,
        async workflowSpecification => {
          const updatedWorkflowSpecification = handleOverwriteUpdate(
            workflowSpecification,
            action.object,
            action.targetCollection.hasSelector
          );

          return validateAndSetupWorkflowSpecification(
            updatedWorkflowSpecification,
            periodical,
            { prevWorkflowSpecification: workflowSpecification }
          );
        },
        { store, ifMatch: action.ifMatch }
      );

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            action,
            {
              result: pick(savedWorkflowSpecification, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          periodical
        ),
        createId('action', action, periodicalId)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, {
        result: savedWorkflowSpecification
      });
    }

    default: {
      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {},
            action.actionStatus !== 'PotentialActionStatus'
              ? {
                  startTime: new Date().toISOString()
                }
              : undefined,
            action.actionStatus === 'StagedActionStatus'
              ? { stagedTime: new Date().toISOString() }
              : undefined,
            action.actionStatus === 'FailedActionStatus'
              ? {
                  endTime: new Date().toISOString()
                }
              : undefined,
            action
          ),
          periodical
        ),
        createId('action', action, periodicalId)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }
  }
}
