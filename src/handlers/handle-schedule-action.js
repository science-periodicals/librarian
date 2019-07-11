import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import schema from '../utils/schema';
import { validateDateTimeDuration } from '../validators';
import setId from '../utils/set-id';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { getMetaActionParticipants } from '../utils/workflow-utils';
import { getObjectId } from '../utils/schema-utils';

// TODO? compute the scheduledTime for the rescheduled action (object) for indexing purpose

/**
 * Handle rescheduling a workflow action
 */
export default async function handleScheduleAction(
  action,
  { store, triggered, prevAction } = {}
) {
  // Validation
  const messages = validateDateTimeDuration(action);
  const objectId = getObjectId(action);
  if (!objectId) {
    messages.push(`${action['@type']} object must be an Action`);
  }

  if (action.actionStatus !== 'CompletedActionStatus') {
    messages.push(
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (messages.length) {
    throw createError(400, `Invalid ${action['@type']}. ${messages.join(' ')}`);
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });

  if (!schema.is(object, 'Action')) {
    throw createError(
      400,
      `{action['@type']} object must point to a valid Action (not ${
        object['@type']
      })`
    );
  }

  const [scopeId] = parseIndexableString(object._id);
  const graphId = createId('graph', scopeId)['@id'];

  const graph = await this.get(graphId, { store, acl: false });
  if (graph['@type'] !== 'Graph') {
    throw createError(
      403,
      `{action['@type']} object must be an Action part of a Graph workflow`
    );
  }

  // validate that the agent is part of the graph
  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceAgent) {
    throw createError(
      400,
      `${
        action['@type']
      } invalid agent, agent could not be found in the Graph ${getId(graph)}`
    );
  }

  const handledObject = handleUserReferences(
    handleParticipants(
      Object.assign({}, object, {
        expectedDuration: action.expectedDuration
      }),
      graph
    ),
    graph
  );

  const handledAgent = remapRole(sourceAgent, 'agent');

  const handledAction = setId(
    handleParticipants(
      Object.assign({ startTime: new Date().toISOString() }, action, {
        agent: handledAgent,
        actionStatus: 'CompletedActionStatus',
        endTime: new Date().toISOString(),
        participant: getMetaActionParticipants(handledObject, {
          addAgent: getId(handledObject.agent) !== getId(handledAgent)
        }),
        result: getId(handledObject),
        // when a workflow action is being rescheduled, the agent of the
        // reschedule action may not have access to the `action` (for instance if
        // an editor reschedule a review before the review completion. To help
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
    { force: true, store }
  );

  // we only sync `savedObject` (the rescheduled action)
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

  return Object.assign({}, savedAction, { result: savedObject });
}
