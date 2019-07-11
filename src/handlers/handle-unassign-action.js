import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getObjectId, getAgentId } from '../utils/schema-utils';
import createId from '../create-id';
import schema from '../utils/schema';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import setId from '../utils/set-id';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import {
  getMetaActionParticipants,
  isAgentSoleAudience
} from '../utils/workflow-utils';
import { isActionAssigned } from '../acl';

/**
 * Unassign an action part of a Graph editorial workflow.
 * Note: no `recipient` need to be specified
 *
 * Note: in case when the object is a ReviewAction and that
 * ReviewAction has its agent as sole audience (only possible
 * for ReviewActions) we reset the ReviewAction to it's template
 * value
 */
export default async function handleUnassignAction(
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

  if (!isActionAssigned(object)) {
    throw createError(
      400,
      `${action['@type']} cannot be used on an unassigned action ${getId(
        object
      )} (${object['@type']})`
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

  // check that the role specified as agent is part of the graph
  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceAgent) {
    throw createError(
      400,
      `Invalid agent, agent could not be found in the Graph ${getId(graph)}`
    );
  }

  // Get the action template so we can reset the agent to its template value
  const template = await this.getActionTemplateByTemplateId(
    getId(object.instanceOf),
    { store }
  );
  if (!template) {
    throw createError(
      400,
      `Dereferenced ${action['@type']} object lacks instanceOf property`
    );
  }

  // Unassign the object
  // Note we only reset the `agent` in case of ReviewAction where the agent is
  // the sole audience. This is to ensure that an `agent` is always defined
  // even when the action is completed following a trigger (e.g completOn:
  // `OnEndorsed`)
  let nextObject = Object.assign({}, object, {
    participant: arrayify(object.participant)
      .filter(
        role => role.roleName !== 'assigner' && role.roleName !== 'unassigner'
      )
      .concat({
        '@id': createId('srole', null, getId(sourceAgent))['@id'],
        roleName: 'unassigner',
        startDate: new Date().toISOString(),
        participant: getAgentId(sourceAgent)
      })
  });

  // Additional side effects for ReviewAction where the agent is the sole
  // audience (can only happen for ReviewAction)
  // in this case:
  // 1. we don't allow unassign if the `object` is Staged and there is a completeOn trigger
  // 2. we reset the value
  if (template['@type'] === 'ReviewAction' && isAgentSoleAudience(template)) {
    if (
      object.actionStatus === 'StagedActionStatus' &&
      object.completeOn === 'OnEndorsed'
    ) {
      throw createError(
        403,
        `${object['@type']} in action status ${
          object.actionStatus
        } and a trigger ${object.completeOn} can't be unassigned`
      );
    }

    // reset value
    nextObject = Object.assign(
      omit(nextObject, [
        'actionStatus',
        'resultReview',
        'comment',
        'annotation',
        'agent' // we always reset the agent ReviewAction where the agent is the sole audience
      ]),
      pick(template, [
        'agent',
        'actionStatus',
        'resultReview',
        'comment',
        'annotation'
      ]),
      getId(nextObject.resultReview)
        ? {
            resultReview: Object.assign(
              {},
              template.resultReview,
              pick(nextObject.resultReview, ['@id', '@type']),
              getId(nextObject.resultReview.reviewRating)
                ? {
                    reviewRating: Object.assign(
                      {},
                      template.resultReview &&
                        template.resultReview.reviewRating,
                      pick(nextObject.resultReview.reviewRating, ['@id'])
                    )
                  }
                : undefined
            )
          }
        : undefined
    );
  }

  const handledAgent = remapRole(sourceAgent, 'agent', { dates: false });
  let handledObject = handleParticipants(nextObject, graph);

  const handledAction = setId(
    handleParticipants(
      Object.assign({ startTime: new Date().toISOString() }, action, {
        agent: handledAgent,
        recipient: remapRole(object.agent, 'recipient', { dates: false }), // the former agent (who has been unassigned) is listed as recipient of the unassign action
        actionStatus: 'CompletedActionStatus',
        participant: getMetaActionParticipants(handledObject, {
          addAgent: getId(handledObject.agent) !== getId(handledAgent)
        }),
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

  handledObject = handleUserReferences(handledObject, graph);

  const [savedAction, savedObject] = await this.put(
    [handledAction, handledObject],
    {
      store,
      force: true
    }
  );

  // we only sync `savedObject` (the unassigned action)
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
