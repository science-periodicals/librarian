import pick from 'lodash/pick';
import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';
import {
  getFramedGraphTemplate,
  getWorkflowMap
} from '../utils/workflow-actions';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import setId from '../utils/set-id';
import getScopeId from '../utils/get-scope-id';
import { getObjectId } from '../utils/schema-utils';

/**
 * Allow to answer question present in ReviewAction.answer or DeclareAction.question
 * The parent ReviewAction or DeclareAction must be part of a workflow
 */
export default async function handleReplyAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (!action.resultComment || action.resultComment['@type'] !== 'Answer') {
    throw createError(
      400,
      `ReplyAction must have a resultComment property containing an Answer`
    );
  }

  const questionId = getObjectId(action);
  if (!questionId) {
    throw createError(
      400,
      `invalid object for ${action['@type']}. Object must point to a Question`
    );
  }

  if (
    action.resultComment.parentItem &&
    getId(action.resultComment.parentItem) !== questionId
  ) {
    throw createError(
      400,
      `The answer parentItem must match the action object`
    );
  }

  // Get parent ReviewAction or DeclareAction
  let parentAction = await this.getEmbedderByEmbeddedId(questionId, { store });
  if (
    parentAction['@type'] !== 'DeclareAction' &&
    parentAction['@type'] !== 'ReviewAction'
  ) {
    throw createError(
      400,
      `Question must be attached to an DeclareAction or a ReviewAction (got: ${
        parentAction['@type']
      })`
    );
  }

  const graph = await this.get(getScopeId(getObjectId(parentAction)), {
    store,
    acl: false
  });

  const workflowSpecification = await this.get(getId(graph.workflow), {
    store,
    acl: false
  });

  const framedGraphTemplate = await getFramedGraphTemplate(
    workflowSpecification
  );
  const workflowMap = getWorkflowMap(framedGraphTemplate);

  const template = workflowMap[getId(parentAction.instanceOf)];
  if (!template) {
    throw createError(
      400,
      `Could not find the ${parentAction['@type']} template`
    );
  }

  const role = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });

  if (!role) {
    throw createError(
      400,
      `Invalid agent for ${
        action['@type']
      }, agent could not be found in the Graph ${getId(graph)}`
    );
  }

  // Check that agent of the ReplyAction is compatible with the definition of the agent of the template
  if (
    template.agent &&
    (template.agent.roleName !== role.roleName ||
      (template.agent.name && template.agent.name !== role.name))
  ) {
    throw createError(
      400,
      'Agent is not compliant with the definition of the action template'
    );
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      // Add agent of the reply action as participant of the parent action
      parentAction = Object.assign(parentAction, {
        participant: arrayify(parentAction.participant)
          .filter(participant => getId(participant) !== getId(role))
          .concat(remapRole(role, 'participant'))
      });

      // Add Answer to the parent action
      if (parentAction['@type'] === 'ReviewAction') {
        parentAction = Object.assign({}, parentAction, {
          answer: dearrayify(
            parentAction.answer,
            arrayify(parentAction.answer).map(answer => {
              if (
                answer.parentItem &&
                getId(answer.parentItem) === questionId
              ) {
                return Object.assign(
                  {},
                  omit(action.resultComment, ['parentItem']),
                  pick(answer, ['@id', 'parentItem']) // make sure that the @id is not changed
                );
              }

              return answer;
            })
          )
        });
      } else if (parentAction['@type'] === 'DeclareAction') {
        parentAction = Object.assign({}, parentAction, {
          result: dearrayify(
            parentAction.result,
            arrayify(parentAction.result).map(result => {
              if (getId(result.parentItem) === questionId) {
                const prevAnswer = arrayify(parentAction.result).find(
                  result =>
                    result.parentItem && getId(result.parentItem) === questionId
                );

                return Object.assign(
                  {},
                  omit(action.resultComment, ['parentItem']),
                  pick(prevAnswer, ['@id', 'parentItem'])
                );
              }
              return result;
            })
          )
        });
      }

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString()
            },
            action,
            { result: getId(handledParentAction) }
          ),
          graph
        ),
        createId('action', action, graph)
      );

      const handledParentAction = handleParticipants(parentAction, graph);

      const [savedParentAction, savedAction] = await this.put(
        [handledParentAction, handledAction],
        { force: true, store }
      );

      // We only sync the parent action to the graph
      try {
        await this.syncGraph(graph, savedParentAction, { store });
      } catch (err) {
        this.log.error({ err, action: savedAction }, 'error syncing graphs');
      }

      try {
        await this.syncWorkflow(savedParentAction, { store });
      } catch (err) {
        this.log.error(
          { err, action: savedParentAction },
          'error syncing workflowStage'
        );
      }

      return Object.assign({}, savedAction, { result: savedParentAction });
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
          graph
        ),
        createId('action', action, graph)
      );

      return await this.put(handledAction, { force: true, store });
    }
  }
}
