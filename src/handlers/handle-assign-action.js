import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import createId from '../create-id';
import schema from '../utils/schema';
import { getObjectId, getAgentId } from '../utils/schema-utils';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import setId from '../utils/set-id';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { getMetaActionParticipants } from '../utils/workflow-utils';

/**
 * Set the agent of of workflow action (specified as the `recipient` of the AssignAction)
 */
export default async function handleAssignAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      `${action['@type']} action object must point to a valid action`
    );
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });
  if (!schema.is(object, 'Action')) {
    throw createError(
      400,
      `${action['@type']} action object must point to a valid action`
    );
  }

  // get Graph (scope)
  const [scopeId] = parseIndexableString(object._id);
  const graphId = createId('graph', scopeId)['@id'];
  const graph = await this.get(graphId, {
    store,
    acl: false
  });
  if (graph['@type'] !== 'Graph') {
    throw createError(
      403,
      `{action['@type']} object must be an Action part of a Graph workflow`
    );
  }

  // Ensure that all the docs required are present before proceeding further
  await this.ensureAllWorkflowActionsStateMachineStatus(scopeId, { store });

  // check that the role specified as agent and recipient are part of the graph
  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceAgent) {
    throw createError(
      400,
      `Invalid agent, agent could not be found in the Graph ${getId(graph)}`
    );
  }

  const sourceRecipient = findRole(action.recipient, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceRecipient) {
    throw createError(
      400,
      'Invalid recipient, recipient could not be found in the Graph ${getId(graph)}'
    );
  }

  // check that recipient is compatible with the conditions expressed in object.agent
  const template = await this.getActionTemplateByTemplateId(
    getId(object.instanceOf),
    { store }
  );

  if (
    template.agent &&
    template.agent.roleName &&
    (template.agent.roleName !== sourceRecipient.roleName ||
      (template.agent.name && template.agent.name !== sourceRecipient.name))
  ) {
    throw createError(
      400,
      `AssignAction recipient must be a role compatible (${[
        template.agent.roleName,
        template.agent.name
      ]
        .filter(Boolean)
        .join(', ')}) with the object agent specification`
    );
  }

  // Ensure that there are no other ongoing invites for the same purpose
  // Note that we already have a global lock on the object thanks to
  // librarian#createWorkflowActionLock
  // Note: !!! the same check must be used in the InviteAction handler
  // Note: the `getActiveInviteActionsByPurposeId` is safe wrt CouchDB 2.x /
  // eventual consistency as we preloaded the store with `ensureAllWorkflowActionsStateMachineStatus`
  // upstream
  const otherActiveInviteActions = await this.getActiveInviteActionsByPurposeId(
    getId(object),
    { store }
  );
  if (
    otherActiveInviteActions.some(
      inviteAction => getId(inviteAction) !== getId(action)
    )
  ) {
    throw createError(
      423,
      `An ActiveInviteAction with the same purpose already exists`
    );
  }

  // If `object` is a polyton action (minInstances > 1), check that no
  // other instance from same stage (resultOf) and same template (instanceOf) has
  // the same agent otherwise error.
  // Note: we already have a global lock on the instances thanks to
  // librarian#createWorkflowActionLock
  // Note: the `getActionsByStageIdAndTemplateId` is safe wrt CouchDB 2.x /
  // eventual consistency as we preloaded the store with `ensureAllWorkflowActionsStateMachineStatus`
  // upstream
  if (object.minInstances > 1) {
    const stageId = getId(object.resultOf);
    const templateId = getId(object.instanceOf);

    // Note: `getActionsByStageIdAndTemplateId` is safe wrt CouchDB 2.x /
    // eventual consistency as the store has been preloaded upstream
    const polytonActions = await this.getActionsByStageIdAndTemplateId(
      stageId,
      templateId
    );

    if (
      polytonActions.some(action => {
        const agent =
          findRole(action.agent, graph, {
            ignoreEndDateOnPublicationOrRejection: true
          }) || action.agent;
        // ! action may not have a userId (due to anonymity constraints we don't
        // store the user id of active workflow action) so we be sure to also
        // compare the role @id
        return (
          (getId(agent) && getId(agent) === getId(sourceRecipient)) ||
          (getAgentId(agent) &&
            getAgentId(agent) === getAgentId(sourceRecipient))
        );
      })
    ) {
      throw createError(
        423,
        `Another ${
          object['@type']
        } is already assigned to the recipient of the ${action['@type']}`
      );
    }
  }

  // assign the object and add the agent as assigner
  const handledObject = handleUserReferences(
    handleParticipants(
      Object.assign({}, object, {
        agent: remapRole(sourceRecipient, 'agent'),
        participant: arrayify(object.participant)
          .filter(
            role =>
              role.roleName !== 'assigner' && role.roleName !== 'unassigner'
          )
          .concat({
            '@id': createId('srole', null, getId(sourceAgent))['@id'],
            roleName: 'assigner',
            startDate: new Date().toISOString(),
            participant: getAgentId(sourceAgent)
          })
      }),
      graph
    ),
    graph
  );

  const handledAgent = remapRole(sourceAgent, 'agent', { dates: false });

  const handledAction = setId(
    handleParticipants(
      Object.assign({ startTime: new Date().toISOString() }, action, {
        agent: handledAgent,
        recipient: Object.assign(
          action.recipient.name ? { name: action.recipient.name } : {},
          remapRole(sourceRecipient, 'recipient', { dates: false })
        ),
        participant: getMetaActionParticipants(handledObject, {
          addAgent: getId(handledObject.agent) !== getId(handledAgent)
        }),
        actionStatus: 'CompletedActionStatus',
        endTime: new Date().toISOString(),
        result: getId(handledObject),
        // when a workflow action is being assigned, the agent of the
        // assign action may not have access to the `action` (for instance if
        // an editor assign a review before the review completion. To help
        // with that we provide an access to the workflow stage
        // (`handledObject.resultOf`) as the stage will be accessible to all parties
        instrument: getId(handledObject.resultOf)
      }),
      graph
    ),
    createId('action', action, graph)
  );

  if (!handledAction.participant.length) {
    delete handledAction.participant;
  }

  const [savedAction, savedObject] = await this.put(
    [handledAction, handledObject],
    {
      store,
      force: true
    }
  );

  // we only sync `savedObject` (the assigned action)
  try {
    await this.syncGraph(graph, savedObject, { store });
  } catch (err) {
    this.log.error({ err, action: savedObject }, 'error syncing graphs');
  }

  try {
    await this.syncWorkflow(savedObject, { store });
  } catch (err) {
    this.log.error({ err, action: savedObject }, 'error syncing workflowStage');
  }

  return Object.assign(savedAction, { result: savedObject });
}
