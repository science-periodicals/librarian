import createError from '@scipe/create-error';
import { arrayify, getId } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';

// TODO? do not let user accept the ms (send to stage with a PublishAction) if
// there are open RevisionRequestComment
// -> probably better handled at the CreateReleaseAction level: can't complete
// CRA if there are open RevisionRequestComment

/**
 * An AssessAction must be part of a workflow
 */
export default async function handleAssessAction(
  action,
  { store, triggered, prevAction, skipPayments, sideEffects = true } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      `{action['@type']} object must point to a Graph (release)`
    );
  }

  const graph = await this.get(
    getScopeId(objectId), // unversion
    { store, acl: false }
  );

  if (graph['@type'] !== 'Graph') {
    throw createError(
      400,
      `{action['@type']} object must point to a Graph (release)`
    );
  }

  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  // validate `result`
  let result = arrayify(action.result)[0];
  if (
    action.actionStatus === 'CompletedActionStatus' ||
    action.actionStatus === 'StagedActionStatus'
  ) {
    const nResults = arrayify(action.result).length;
    if (nResults !== 1) {
      throw createError(
        400,
        `AssessAction must contain 1 result (and 1 only, got ${nResults})`
      );
    }

    if (
      !arrayify(action.potentialResult).some(
        potentialResult => getId(potentialResult) === getId(result)
      )
    ) {
      throw createError(
        400,
        'Invalid AssessAction result. The result cannot be found in the potentialResult'
      );
    }
  }

  // replace by the potential result in case `result` was just an @id
  result = arrayify(action.potentialResult).find(
    potentialResult => getId(potentialResult) === getId(result)
  );

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const assessActionEndTime = new Date();
      const stageDate = new Date(assessActionEndTime.getTime() + 1);

      switch (result['@type']) {
        case 'StartWorkflowStageAction': {
          const workflowSpecification = await this.get(getId(graph.workflow), {
            acl: false,
            store
          });

          // Instantiate the stage
          const {
            startWorkflowStageAction,
            instantiatedActions
          } = await this.instantiateWorkflowStage(
            result,
            workflowSpecification,
            objectId, // releaseId
            {
              agent: action.agent,
              startTime: stageDate.toISOString(),
              endTime: stageDate.toISOString(),
              resultOf: action
            }
          );

          const handledAction = handleUserReferences(
            handleParticipants(
              Object.assign(
                {
                  endTime: assessActionEndTime.toISOString()
                },
                action,
                {
                  result: startWorkflowStageAction // we embed the full stage so that the changes feed has the data immediately as the AssessAction can be emitted before the stage is committed to disk an therefore dereferencing the result @id is not guaranteed to return a result
                }
              ),
              graph,
              assessActionEndTime
            ),
            graph
          );

          const handledWorkflowActions = [
            startWorkflowStageAction,
            ...instantiatedActions
          ].map(action =>
            handleUserReferences(
              handleParticipants(action, graph, assessActionEndTime),
              graph
            )
          );

          if (!sideEffects) {
            return handledAction;
          }

          // need to be called when action is handled but _before_ it is saved or
          // side effects are executed so it can be easily retried if failures
          await this.createCharge(handledAction, { store, skipPayments });
          await this.createUsageRecord(handledAction, { store, skipPayments });
          await this.createInvoiceItem(handledAction, { store, skipPayments });

          const [
            savedAction,
            savedStage,
            ...savedWorkflowActions
          ] = await this.put([handledAction, ...handledWorkflowActions], {
            store,
            force: true
          });

          try {
            await this.syncGraph(
              graph,
              [savedAction]
                .concat(arrayify(savedStage), arrayify(savedWorkflowActions))
                .filter(Boolean),
              { store }
            );
          } catch (err) {
            this.log.error(
              { err, action: savedAction },
              'error syncing graphs'
            );
          }

          try {
            await this.syncWorkflow(
              Object.assign({}, savedAction, { result: getId(result) }),
              { store }
            );
          } catch (err) {
            this.log.error(
              { err, action: savedAction },
              'error syncing workflowStage'
            );
          }

          return Object.assign({}, savedAction, {
            result: savedStage
          });
        }

        case 'RejectAction': {
          const handledAction = handleUserReferences(
            handleParticipants(
              Object.assign(
                {
                  endTime: assessActionEndTime.toISOString()
                },
                action,
                {
                  result: result // we embed full result for convenience to the changes feed consumer
                }
              ),
              graph,
              assessActionEndTime
            ),
            graph
          );

          if (!sideEffects) {
            return handledAction;
          }

          const savedAction = await this.put(handledAction, {
            store,
            force: true
          });

          try {
            await this.syncGraph(graph, savedAction, {
              store,
              endRoles: true,
              now: assessActionEndTime.toISOString(),
              updatePayload: {
                deteEnded: assessActionEndTime.toISOString(),
                dateRejected: assessActionEndTime.toISOString()
              }
            });
          } catch (err) {
            this.log.error(
              { err, action: savedAction },
              'error syncing graphs'
            );
          }

          try {
            await this.syncWorkflow(
              Object.assign({}, savedAction, { result: getId(result) }),
              { store }
            );
          } catch (err) {
            this.log.error(
              { err, action: savedAction },
              'error syncing workflowStage'
            );
          }

          return savedAction;
        }

        default:
          throw createError(
            403,
            'invalid result @type. Possible results are: RejectAction or StartWorkflowStageAction'
          );
      }
    }

    default: {
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
        this.log.error(
          { err, action: savedAction },
          'error syncing workflowStage'
        );
      }

      return savedAction;
    }
  }
}
