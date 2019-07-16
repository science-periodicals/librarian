import createError from '@scipe/create-error';
import { getId, arrayify, getNodeMap } from '@scipe/jsonld';
import isEqual from 'lodash/isEqual';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import getScopeId from '../utils/get-scope-id';
import { getObjectId } from '../utils/schema-utils';

/**
 * A DeclareAction must be part of a workflow
 */
export default async function handleDeclareAction(
  action,
  { store, triggered, prevAction, skipPayments, sideEffects = true } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `${action['@type']} object must be a Graph`);
  }

  const graph = await this.get(getScopeId(objectId), {
    store,
    acl: false
  });

  if (graph['@type'] !== 'Graph') {
    throw createError(400, `${action['@type']} object must point to a Graph`);
  }

  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  if (prevAction) {
    // questions cannot be mutated (or re-ordered)
    const prevQuestions = arrayify(prevAction.question).filter(
      question => question['@type'] === 'Question' && question['@id']
    );

    const prevQuestionIds = prevQuestions.map(getId);
    const previousQuestionsMap = getNodeMap(prevQuestions);

    const currentQuestions = arrayify(action.question).filter(
      question => question['@type'] === 'Question'
    );
    const currentQuestionIds = currentQuestions.map(getId);

    if (
      Object.keys(previousQuestionsMap).length !== currentQuestions.length ||
      !isEqual(prevQuestionIds, currentQuestionIds) ||
      currentQuestions.some(question => {
        return (
          !(question['@id'] in previousQuestionsMap) ||
          !isEqual(question, previousQuestionsMap[question['@id']])
        );
      })
    ) {
      throw createError(403, 'Questions cannot be mutated or re-ordered');
    }

    // answer @ids and parentItem (in `result`) cannot be mutated (or re-ordered)
    const prevAnswers = arrayify(prevAction.result).filter(
      answer => answer['@type'] === 'Answer' && answer['@id']
    );
    const prevAnswerIds = prevAnswers.map(getId);
    const prevAnswerMap = getNodeMap(prevAnswers);

    const currentAnswers = arrayify(action.result).filter(
      result => result['@type'] === 'Answer'
    );
    const currentAnswerIds = currentAnswers.map(getId);

    if (
      Object.keys(prevAnswerMap).length !== currentAnswers.length ||
      !isEqual(prevAnswerIds, currentAnswerIds) ||
      currentAnswers.some(answer => {
        return (
          !(answer['@id'] in prevAnswerMap) ||
          getId(answer.parentItem) !==
            getId(prevAnswerMap[getId(answer)].parentItem)
        );
      })
    ) {
      throw createError(
        403,
        'Answer @id and parentItem cannot be mutated or re-ordered'
      );
    }
  }

  switch (action.actionStatus) {
    case 'StagedActionStatus':
    case 'CompletedActionStatus': {
      // DeclareAction cannot be staged / completed if all the questions haven't been answered
      if (
        arrayify(action.question).some(
          question =>
            question['@type'] === 'Question' &&
            arrayify(action.result).some(
              answer =>
                answer['@type'] === 'Answer' &&
                getId(answer.parentItem) === getId(question) &&
                (answer.text == null || answer.text == '')
            )
        )
      ) {
        throw createError(
          403,
          `DeclareAction cannot be marked as ${action.actionStatus} untill all the questions have been answered`
        );
      }
      break;
    }

    default: {
      break;
    }
  }

  const handledAction = handleUserReferences(
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
        action.actionStatus === 'CompletedActionStatus' ||
          action.actionStatus === 'FailedActionStatus'
          ? {
              endTime: new Date().toISOString()
            }
          : undefined,
        action
      ),
      graph
    ),
    graph
  );

  if (!sideEffects) {
    return handledAction;
  }

  // need to be called when action is handled but _before_ it is saved or
  // side effects are executed so it can be easily retry if failures
  await this.createCharge(handledAction, { store, skipPayments });
  await this.createUsageRecord(handledAction, { store, skipPayments });
  await this.createInvoiceItem(handledAction, { store, skipPayments });

  const savedAction = await this.put(handledAction, {
    store,
    force: true
  });

  try {
    await this.syncGraph(graph, savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing graphs');
  }

  try {
    await this.syncWorkflow(savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing workflowStage');
  }

  return savedAction;
}
