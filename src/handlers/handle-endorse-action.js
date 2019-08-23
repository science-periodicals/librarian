import pickBy from 'lodash/pickBy';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import handleParticipants from '../utils/handle-participants';
import getScopeId from '../utils/get-scope-id';
import { getObjectId, getAgentId } from '../utils/schema-utils';
import createId from '../create-id';
import {
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * EndorseAction cannot be instantiated by the user. They are instantiated
 * through the instantiation of a WorkflowStage
 * => `prevAction` must be defined
 *
 * Note: the audience of an EndorseAction is set
 * by librarian during the `CreateWorkflowSpecificationAction`
 *
 * Side effect: set the `actionStatus` of the `object` to `EndorsedActionStatus`
 */
export default async function handleEndorseAction(
  action,
  { store, triggered, prevAction, sideEffects = true } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }, object must point to an Action to be endorsed`
    );
  }

  const endorsedAction = await this.get(objectId, {
    store,
    acl: false
  });

  const scopeId = getScopeId(endorsedAction);

  // we grab the graph
  const graph = await this.get(scopeId, {
    store,
    acl: false
  });

  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  const now = getActionStatusTime(action) || new Date().toISOString();

  const handledAction = pickBy(
    handleParticipants(
      Object.assign(setDefaultActionStatusTime(action, now), {
        result: getId(endorsedAction)
      }),
      graph,
      now
    ),
    x => x !== undefined
  );

  if (!sideEffects) {
    return handledAction;
  }

  let updatedEndorsedAction;
  if (action.actionStatus === 'CompletedActionStatus') {
    // side effect
    updatedEndorsedAction = await this.update(
      endorsedAction,
      endorsedAction => {
        return Object.assign({}, endorsedAction, {
          actionStatus: 'EndorsedActionStatus',
          endorsedTime: new Date().toISOString(),
          participant: arrayify(endorsedAction.participant)
            .filter(role => role.roleName !== 'endorser')
            .concat({
              '@id': createId('srole', null, getId(action.agent))['@id'],
              '@type': 'ContributorRole',
              roleName: 'endorser',
              startDate: now,
              participant: getAgentId(action.agent)
            })
        });
      },
      { store }
    );
  }

  const savedAction = await this.put(handledAction, {
    acl: false,
    force: true,
    store
  });

  try {
    await this.syncGraph(graph, savedAction, {
      store
    });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing graphs');
  }

  try {
    await this.syncWorkflow(savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing workflowStage');
  }

  return updatedEndorsedAction
    ? Object.assign({}, savedAction, { result: updatedEndorsedAction })
    : savedAction;
}
