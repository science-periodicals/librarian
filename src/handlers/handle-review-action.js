import pick from 'lodash/pick';
import isEqual from 'lodash/isEqual';
import createError from '@scipe/create-error';
import { arrayify, getId } from '@scipe/jsonld';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import { getObjectId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import {
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * A ReviewAction must be part of a workflow
 */
export default async function handleReviewAction(
  action,
  { store, triggered, prevAction, skipPayments, sideEffects = true } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be a Graph`);
  }

  const graph = await this.get(getScopeId(objectId), {
    store,
    acl: false
  });

  if (graph['@type'] !== 'Graph') {
    throw createError(400, `{action['@type']} object must point to a Graph`);
  }

  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  if (prevAction) {
    //  answers order, @id and parentItem (questions) must be preserved
    const prevAnswerStubs = arrayify(prevAction.answer).map(answer => {
      return pick(answer, ['@id', '@type', 'parentItem']);
    });

    const answerStubs = arrayify(action.answer)
      .filter(answer => answer['@type'] === 'Answer')
      .map(answer => {
        return pick(answer, ['@id', '@type', 'parentItem']);
      });

    if (!isEqual(prevAnswerStubs, answerStubs)) {
      throw createError(
        403,
        `${
          action['@type']
        } answers order, @id and parentItem (questions) cannot be mutated`
      );
    }

    if (prevAction.resultReview) {
      // review @id cannot be mutated
      if (
        getId(action.resultReview) &&
        getId(prevAction.resultReview) !== getId(action.resultReview)
      ) {
        throw createError(
          403,
          `${
            action['@type']
          } resultReview @id cannot be mutated and should be ${getId(
            prevAction.resultReview
          )} (got ${getId(action.resultReview)})`
        );
      }
      if (!getId(action.resultReview)) {
        // bring back prev value
        action = Object.assign({}, action, {
          resultReview: Object.assign(
            {},
            action.resultReview,
            pick(prevAction.resultReview, ['@id', '@type'])
          )
        });
      }

      // review rating `bestRating` and `worstRating` cannot be mutated
      if (prevAction.resultReview.reviewRating) {
        const prevReviewRating = prevAction.resultReview.reviewRating;
        const reviewRating =
          action.resultReview && action.resultReview.reviewRating;

        // bring back default
        action = Object.assign({}, action, {
          resultReview: Object.assign({}, action.resultReview, {
            reviewRating: Object.assign({}, prevReviewRating, reviewRating)
          })
        });

        const mutated = Object.keys(prevReviewRating).filter(p => {
          reviewRating[p] !== prevReviewRating[p];
        });
        if (mutated.length) {
          throw createError(403, 'Review ratings settings cannot be mutated');
        }
      }
    }
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus':
    case 'StagedActionStatus': {
      // ReviewAction cannot be completed if all the questions haven't been
      // answered

      if (
        arrayify(action.answer).some(answer => {
          return (
            answer['@type'] === 'Answer' &&
            answer.parentItem &&
            answer.parentItem['@type'] === 'Question' &&
            (answer.text == null || answer.text == '')
          );
        })
      ) {
        throw createError(
          403,
          `ReviewAction cannot be marked as ${action.actionStatus} untill all the questions have been answered`
        );
      }
      break;
    }

    default: {
      break;
    }
  }

  const now = getActionStatusTime(action) || new Date().toISOString();

  const handledAction = handleUserReferences(
    handleParticipants(setDefaultActionStatusTime(action, now), graph, now),
    graph
  );

  if (!sideEffects) {
    return handledAction;
  }

  // need to be called when action is handled but _before_ it is saved or
  // side effects are executed so it can be easily retried if failures
  await this.createCharge(handledAction, { store, skipPayments });
  await this.createUsageRecord(handledAction, { store, skipPayments });
  await this.createInvoiceItem(handledAction, { store, skipPayments });

  const savedAction = await this.put(handledAction, {
    force: true,
    store
  });

  try {
    await this.syncGraph(graph, savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing graph');
  }

  try {
    await this.syncWorkflow(savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing workflowStage');
  }

  return savedAction;
}
