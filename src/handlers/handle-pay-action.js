import omit from 'lodash/omit';
import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import getScopeId from '../utils/get-scope-id';
import { getObjectId } from '../utils/schema-utils';
import createId from '../create-id';
import {
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * A PayAction must be part of a workflow
 *
 * Note: we allow PayAction with a paymentToken and no requestedPrice to bypass
 * the EndorseAction and go directly to CompletedActionStatus stage
 */
export default async function handlePayAction(
  action,
  { store, triggered, prevAction, skipPayments, sideEffects = true } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be a Graph`);
  }

  const graph = await this.get(getScopeId(objectId), {
    acl: false
  });

  if (graph['@type'] !== 'Graph') {
    throw createError(400, `{action['@type']} object must point to a Graph`);
  }

  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const effectivePrice =
        'requestedPrice' in action
          ? action.requestedPrice
          : action.priceSpecification.price;

      if (effectivePrice > 0) {
        // validate that action has a PaymentToken
        if (
          !action.paymentToken ||
          typeof action.paymentToken.value !== 'string'
        ) {
          throw createError(
            400,
            `${
              action['@type']
            } must have a valid paymentToken (object with a defined value property set to a valid stripe source)`
          );
        }
      }

      const now = action.endTime || new Date().toISOString();
      const handledAction = handleUserReferences(
        handleParticipants(
          Object.assign(
            {
              startTime: now
            },
            omit(action, ['endorseOn', 'completeOn']),
            {
              endTime: now,
              // we set `result` to an `Order` to facilitate reporting in
              // app-suite payment settings (the `seller` prop gives us access to the
              // Organization)
              result: {
                '@id': createId('node')['@id'],
                '@type': 'Order',
                seller: getId(graph.publisher)
              }
            }
          ),
          graph,
          now
        ),
        graph
      );

      // if there was an OnEndorsed trigger, we "auto" execute it to neutralize it (implicit endorsement)
      let handledEndorseActions = [];
      if (
        action.endorseOn === 'OnEndorsed' ||
        action.completeOn === 'OnEndorsed'
      ) {
        const endorseActions = await this.getActionsByObjectIdAndType(
          getId(action),
          'EndorseAction',
          { store }
        );

        handledEndorseActions = endorseActions.map(endorseAction =>
          Object.assign(
            {
              startTime: new Date().toISOString()
            },
            omit(endorseAction, ['activateOn', 'completeOn']),
            {
              agent: 'bot:scipe',
              actionStatus: 'CompletedActionStatus',
              endTime: new Date().toISOString()
            }
          )
        );
      }

      if (!sideEffects) {
        return handledAction;
      }

      // need to be called when action is handled but _before_ it is saved or
      // side effects are executed so it can be easily retry if failures
      await this.createCharge(handledAction, { store, skipPayments });
      await this.createUsageRecord(handledAction, { store, skipPayments });
      await this.createInvoiceItem(handledAction, { store, skipPayments });

      const [savedAction, ...savedEndorseActions] = await this.put(
        [handledAction, ...handledEndorseActions],
        {
          force: true,
          store
        }
      );

      try {
        await this.syncGraph(graph, [savedAction, ...savedEndorseActions], {
          store
        });
      } catch (err) {
        this.log.error({ err, action: savedAction }, 'error syncing graphs');
      }

      try {
        await this.syncWorkflow([savedAction, ...savedEndorseActions], {
          store
        });
      } catch (err) {
        this.log.error(
          { err, action: savedAction },
          'error syncing workflowStage'
        );
      }

      return savedAction;
    }

    default: {
      const now = getActionStatusTime(action) || new Date().toISOString();

      const handledAction = handleUserReferences(
        handleParticipants(setDefaultActionStatusTime(action, now), graph, now),
        graph
      );

      if (!sideEffects) {
        return handledAction;
      }

      const savedAction = await this.put(handledAction, {
        force: true,
        store
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
