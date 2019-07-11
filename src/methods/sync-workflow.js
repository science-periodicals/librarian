import pick from 'lodash/pick';
import { getId, dearrayify, arrayify, unrole } from '@scipe/jsonld';
import handleUserReferences from '../utils/handle-user-references';

const syncedActionTypes = new Set([
  'EndorseAction',
  'CreateReleaseAction',
  'PublishAction',
  'DeclareAction',
  'ReviewAction',
  'AssessAction',
  'PayAction',
  'BuyAction',
  'TypesettingAction'
]);

/**
 * Update (or remove) inlined `actions` in the workflow stage
 * ( indicated by `action.resultOf`).
 *
 * We need that to provide access to previews of all the actions of a stage
 * even if the user doesn't have access to the individual action (not part of
 * the audience). This is usefull to render a complete timeline for instance
 *
 * return a list of updated stages
 */
export default async function syncWorkflow(actions, { store } = {}) {
  actions = arrayify(actions).filter(
    action => getId(action.resultOf) && syncedActionTypes.has(action['@type'])
  );

  const stageIds = Array.from(
    new Set(actions.map(action => getId(action.resultOf)))
  );

  const updatedStages = [];

  for (const stageId of stageIds) {
    const updatedStage = await this.update(
      stageId,
      stage => {
        return updateStage(
          stage,
          actions.filter(action => getId(action.resultOf) === getId(stage))
        );
      },
      { store }
    );
    updatedStages.push(updatedStage);
  }

  return updatedStages;
}

function updateStage(stage, actions) {
  arrayify(actions).forEach(sourceAction => {
    // we make sure that the embedded actions contain no user references
    sourceAction = handleUserReferences(sourceAction, null, {
      forceRemove: true
    });

    if (sourceAction._deleted) {
      deleteAction(stage, sourceAction);
    } else {
      // find the action (`sinkAction`) to update (mutate in place) in `stage`
      let sinkAction;

      topLoop: for (const action of arrayify(stage.result)) {
        const target = findAction(getId(sourceAction), action);
        if (target) {
          sinkAction = target;
          break topLoop;
        }

        if (action['@type'] === 'CreateReleaseAction') {
          if (action.result && action.result.potentialAction) {
            for (const pAction of arrayify(action.result.potentialAction)) {
              const target = findAction(getId(sourceAction), pAction);
              if (target) {
                sinkAction = target;
                break topLoop;
              }
            }
          }

          if (
            sourceAction['@type'] === 'BuyAction' &&
            getId(sourceAction.instrumentOf) === getId(action)
          ) {
            addBuyAction(action, sourceAction);
          }
        }
      }

      if (sinkAction) {
        Object.assign(
          sinkAction,
          pick(sourceAction, [
            'actionStatus',
            'expectedDuration',
            'pendingEndorsementTime',
            'startTime',
            'endTime',
            'agent',
            'participant',
            'recipient'
          ])
        );

        ['agent', 'participant', 'recipient'].forEach(p => {
          if (!sourceAction[p]) {
            delete sinkAction[p];
          }
        });
      }
    }
  });

  return stage;
}

/**
 * Delete `action` from stage.
 *
 * Note: only polyton actions can be deleted => the action to delete is either in
 * result of stage or in potentialAction, potentialService or expectAcceptanceOf
 * of the result of a CreateReleaseAction
 *
 * Note: requiresCompletionOf does _not_ need to be deleted as the action where
 * it should be removed will be synced to the stage as well...
 */
function deleteAction(stage, action) {
  function deleteFromProp(object, prop) {
    if (arrayify(object[prop]).some(value => getId(value) === getId(action))) {
      object[prop] = arrayify(object[prop]).filter(
        value => getId(value) !== getId(action)
      );
      if (!object[prop].length) {
        delete object[prop];
      }
    }
  }

  deleteFromProp(stage, 'result');

  // action can be burried into CreateReleaseAction
  arrayify(stage.result).forEach(result => {
    if (result['@type'] === 'CreateReleaseAction') {
      const graph = result.result;
      if (graph) {
        deleteFromProp(graph, 'potentialAction');
      }

      if (result.potentialService) {
        arrayify(result.potentialService).forEach(potentialService => {
          arrayify(potentialService.offers).forEach(offer => {
            deleteFromProp(offer, 'potentialAction');
          });
        });
      }
    }
  });
}

/**
 * find `actionId` in `candidateAction` taking into account potentialService etc.
 */
function findAction(actionId, candidateAction) {
  if (getId(candidateAction) === actionId) {
    return candidateAction;
  }

  // InformAction, EndorseAction, AuthorizeAction, DeauthorizeAction
  for (const potentialAction of arrayify(candidateAction.potentialAction)) {
    const target = findAction(actionId, potentialAction);
    if (target) {
      return target;
    }
  }

  // Service action (burried in potentialService) + their endorse action
  for (const service of arrayify(candidateAction.potentialService)) {
    const offer = service.offers;
    if (offer) {
      for (const potentialAction of arrayify(offer.potentialAction)) {
        const target = findAction(actionId, potentialAction);
        if (target) {
          return target;
        }

        // ServiceAction (and their potential action thanks to recursion)
        if (potentialAction.result && potentialAction.result.orderedItem) {
          const target = findAction(
            actionId,
            potentialAction.result.orderedItem
          );
          if (target) {
            return target;
          }
        }
      }
    }
  }
}

/**
 * Mutate `createReleaseAction` by adding the BuyAction to the relevant potentialService
 * Note: the BuyAction is hydrated and contain the full ServiceAction as
 * buyAction.result.orderedItem (and endorse action is potential action of the service action)
 */
function addBuyAction(createReleaseAction, buyAction) {
  const order = unrole(buyAction.result, 'result');

  if (order) {
    const offerId = getId(order.acceptedOffer);
    const serviceId = getId(
      order.acceptedOffer && order.acceptedOffer.itemOffered
    );

    if (serviceId) {
      createReleaseAction.potentialService = dearrayify(
        createReleaseAction.potentialService,
        arrayify(createReleaseAction.potentialService).map(potentialService => {
          // !!potentialService can just be a string
          if (getId(potentialService) === serviceId) {
            const nextService =
              typeof potentialService === 'string'
                ? { '@id': potentialService }
                : potentialService;

            if (!nextService.offers || typeof nextService.offers === 'string') {
              nextService.offers = {
                '@id': offerId,
                '@type': 'Offer'
              };
            }

            nextService.offers.potentialAction = arrayify(
              nextService.offers.potentialAction
            )
              .filter(action => getId(action) !== getId(buyAction))
              .concat(buyAction);

            return nextService;
          }

          return potentialService;
        })
      );
    }
  }
}
