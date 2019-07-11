import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getStageActions } from '../utils/workflow-utils';
import getScopeId from '../utils/get-scope-id';
import { getResultId } from '../utils/schema-utils';
import {
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID
} from '../constants';

/**
 * Add usage record for explorer plans (submission and publication)
 * (if organization is a `voyager` subscriber, everything is included)
 *
 * See https://stripe.com/docs/billing/subscriptions/metered-billing#reporting-usage
 * Note APC & authors services charges are handled by the `createInvoiceItem` and `createCharge` methods.
 */
export default async function createUsageRecord(
  action, // a workflow action (in any status) this method will do the right thing to create the usage record only when needed. The action should be handled (with _id etc.) but this method should be called  _before_ the action is saved to the DB so that usage report can be retried
  {
    store,
    timestamp = Math.ceil(new Date().getTime() / 1000), // !! stripe timestamp are in seconds and JS getTime() is in ms
    skipPayments = false
  } = {}
) {
  skipPayments = skipPayments || this.config.skipPayments;

  if (skipPayments || action.actionStatus !== 'CompletedActionStatus') {
    return;
  }

  switch (action['@type']) {
    case 'DeclareAction':
    case 'CreateReleaseAction':
    case 'PayAction': {
      // submission fee
      const stageId = getId(action.resultOf);

      // we lock to avoid case where 2 actions are completed at the same time
      const lock = await this.createLock(stageId, {
        prefix: 'usageRecord',
        isLocked: null
      });

      try {
        // Charge submission (on first stage if all author actions are completed)
        const stage = await this.get(stageId, {
          acl: false,
          store
        });

        if (getId(stage.resultOf)) {
          // => not the first stage, we already charged for the submission
          return;
        }

        const otherStageAuthorActions = getStageActions(stage).filter(
          stageAction =>
            stageAction.agent &&
            stageAction.agent.roleName === 'author' &&
            getId(stageAction) !== getId(action)
        );

        if (
          !otherStageAuthorActions.every(
            action => action.actionStatus === 'CompletedActionStatus'
          )
        ) {
          // usage record is only created when _all_ author action of the stage are completed
          return;
        }

        // create usage record
        await maybeAddRecord(
          this,
          action,
          SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
          { store, timestamp }
        );
      } catch (err) {
        throw err;
      } finally {
        try {
          await lock.unlock();
        } catch (err) {
          this.log.error(
            err,
            'createUsageRecord: could not unlock lock, but it will auto expire'
          );
        }
      }
      break;
    }

    case 'PublishAction': {
      // publication fee
      await maybeAddRecord(
        this,
        action,
        SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
        { store, timestamp }
      );
      break;
    }

    default:
      break;
  }
}

async function maybeAddRecord(librarian, action, planId, { store, timestamp }) {
  const scopeId = getScopeId(action);
  const graph = await librarian.get(scopeId, { acl: false, store });

  const subscribeAction = await librarian.getActiveSubscribeAction(
    getId(graph.publisher),
    { store }
  );

  const subscription = await librarian.getStripeObject(
    getResultId(subscribeAction),
    {
      store,
      type: 'subscription'
    }
  );

  // we only charge on explorer plan
  if (
    !subscription.items.data.some(
      data =>
        (data.plan &&
          data.plan.id === SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID) ||
        (data.plan &&
          data.plan.id === SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID)
    )
  ) {
    return;
  }

  const subscriptionItem = subscription.items.data.find(
    data => data.plan && data.plan.id === planId
  );

  if (!subscriptionItem) {
    throw createError(
      500,
      `createUsageRecord: could not find subscription item for plan ${planId} (${getId(
        graph.publisher
      )})`
    );
  }

  const resp = await librarian.stripe.usageRecords.create(
    subscriptionItem.id,
    {
      quantity: 1,
      timestamp,
      action: 'increment'
    },
    {
      idempotency_key: `${getResultId(action)}-${planId}` // we take the stageId + plan as several actions can trigger the record in case of submissions
    }
  );

  librarian.log.debug(
    { action, stripeResp: resp },
    'createUsageRecord added record'
  );

  return resp;
}
