import pickBy from 'lodash/pickBy';
import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getResultId } from '../utils/schema-utils';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';
import setId from '../utils/set-id';
import {
  SCIPE_FREE_OFFER_ID,
  SCIPE_EXPLORER_OFFER_ID,
  SCIPE_VOYAGER_OFFER_ID,
  SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_FREE_ACTIVATION_PRICE_USD,
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_ACTIVATION_PRICE_USD,
  SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_ACTIVATION_PRICE_USD
} from '../constants';

/**
 * Note this will create a stripe account (if none exists yet).
 * !! There must be only 1 Active SubscribeAction per organization at all time
 *
 * This action results in a stripe subscription that cannot be canceled. To
 * "stop" the subscription, the user can re-issue a SubscribeAction (with the same
 * @id (or ommitting it)) and update the plan (specifying `expectsAcceptanceOf`) to
 * `SCIPE_FREE_OFFER_ID`
 *
 * See the webhooks (handle-stripe-event.js) to see how failed charged are handled
 * and how `SubscribeAction` end up in `FailedActionStatus` or `CompletedActionStatus`
 * state
 *
 * Note: we subscribe users to 2 plans (submission and publication) so that we
 * can take advantage of stripe reporting feature for invoicing
 *
 * {
 *   '@type': 'SubscribeAction',
 *   agent: 'user:userId',
 *   actionStatus: 'ActiveActionStatus',
 *   expectsAcceptanceOf: 'offer:scipe-explorer',
 *   instrument: 'org:organizationId',
 *   paymentToken: {'@type': 'PaymentToken', value: 'src_18eYalAHEMiOZZp1l9ZTjSU0'},
 *   object: 'service:scipe'
 * }
 */
export default async function handleSubscribeAction(
  action,
  { store, skipPayments } = {}
) {
  if (action.actionStatus !== 'ActiveActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be ActiveActionStatus`
    );
  }

  // validate expectsAcceptanceOf:
  const offerId = getId(action.expectsAcceptanceOf);
  if (
    offerId !== SCIPE_FREE_OFFER_ID &&
    offerId !== SCIPE_EXPLORER_OFFER_ID &&
    offerId !== SCIPE_VOYAGER_OFFER_ID
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } expectsAcceptanceOf must be ${SCIPE_FREE_OFFER_ID},  ${SCIPE_EXPLORER_OFFER_ID} or ${SCIPE_VOYAGER_OFFER_ID} (got ${offerId})`
    );
  }

  const organizationId = getId(action.instrument);
  let organization = await this.get(organizationId, { acl: false, store });

  // We lock so that there is only 1 active `SubscribeAction` per organization at any given type
  const lock = await this.createLock(getId(organization), {
    prefix: 'stripe:subscriptions',
    isLocked: null // See further downstream for additional checks
  });

  try {
    // Check if there is a previous `SubscribeAction`
    let prevActiveSubscribeAction;
    try {
      // Note: `getActiveSubscribeAction` is CouchDB 2.x / eventual consistency safe
      prevActiveSubscribeAction = await this.getActiveSubscribeAction(
        organizationId,
        { store }
      );
    } catch (err) {
      if (err.code !== 404) {
        throw err;
      }
    }

    if (
      prevActiveSubscribeAction &&
      getId(action) &&
      getId(prevActiveSubscribeAction) !== getId(action)
    ) {
      throw createError(
        400,
        `Invalid @id for ${action['@type']}, expected ${getId(
          prevActiveSubscribeAction
        )} got ${getId(action)}`
      );
    }

    // We check if the org already has a stripe customer account and if not we create one
    let customer;
    try {
      // Note: this view is safe wrt eventual consistency
      customer = await this.getStripeCustomerByOrganizationId(organizationId, {
        store
      });
    } catch (err) {
      if (err.code !== 404) {
        throw err;
      }
    }

    if (customer) {
      // update payment method
      if (action.paymentToken && action.paymentToken.value != null) {
        customer = await this.stripe.customers.update(customer.id, {
          source: action.paymentToken.value
        });
      }
    } else {
      const createCustomerAccountAction = await this.post(
        Object.assign(
          {
            '@type': 'CreateCustomerAccountAction',
            agent: action.agent,
            actionStatus: 'CompletedActionStatus',
            object: organizationId
          },
          action.paymentToken && action.paymentToken.value != null
            ? {
                result: {
                  source: action.paymentToken.value
                }
              }
            : undefined
        ),
        { acl: false }
      );
      customer = createCustomerAccountAction.result;
    }

    // validate paymentToken
    // if customer has no default_source, and no payment token is provided and we
    // user subscribe to explorer plan, we error
    if (
      !customer.default_source &&
      offerId === SCIPE_EXPLORER_OFFER_ID &&
      (!action.paymentToken || typeof action.paymentToken.value !== 'string')
    ) {
      throw createError(
        400,
        `${
          action['@type']
        } must have a valid paymentToken (object with a defined value property set to a valid stripe source)`
      );
    }

    var subscription;
    let submissionSubscriptionItem, publicationSubscriptionItem;
    if (prevActiveSubscribeAction) {
      subscription = await this.getStripeObject(
        getResultId(prevActiveSubscribeAction),
        { type: 'subscription', store }
      );

      if (offerId === getId(prevActiveSubscribeAction.expectsAcceptanceOf)) {
        // no op we immediately return
        return Object.assign({}, prevActiveSubscribeAction, {
          result: Object.assign(
            { '@id': getId(prevActiveSubscribeAction.result) },
            subscription
          )
        });
      }

      submissionSubscriptionItem = subscription.items.data.find(
        item =>
          item.plan &&
          item.plan.id &&
          (item.plan.id === SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID ||
            item.plan.id === SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID ||
            item.plan.id === SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID)
      );

      publicationSubscriptionItem = subscription.items.data.find(
        item =>
          item.plan &&
          item.plan.id &&
          (item.plan.id === SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID ||
            item.plan.id === SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID ||
            item.plan.id === SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID)
      );
    }

    const idempotencyKey = prevActiveSubscribeAction
      ? `${getId(prevActiveSubscribeAction)}-${getId(
          prevActiveSubscribeAction.expectsAcceptanceOf
        )}-${prevActiveSubscribeAction.modifiedTime ||
          prevActiveSubscribeAction.startTime}`
      : `${organizationId}--${action['@type']}-${organization.foundingDate ||
          ''}`; // the fundingDate helps if we re-run stories

    // We subscribe the customer to the plan
    let subscriptionItems;
    switch (offerId) {
      case SCIPE_FREE_OFFER_ID:
        subscriptionItems = [
          pickBy({
            id: submissionSubscriptionItem && submissionSubscriptionItem.id,
            plan: SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID
          }),
          pickBy({
            id: publicationSubscriptionItem && publicationSubscriptionItem.id,
            plan: SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID
          })
        ];
        // charge the activation fee
        if (SCIPE_FREE_ACTIVATION_PRICE_USD) {
          await this.stripe.invoiceItems.create(
            {
              amount: SCIPE_FREE_ACTIVATION_PRICE_USD * 100, // in cents
              currency: 'usd',
              customer: customer.id,
              description: 'One-time setup fee for sci.pe Free plan'
            },
            {
              idempotency_key: `invoice-${idempotencyKey}`
            }
          );
        }
        break;

      case SCIPE_EXPLORER_OFFER_ID:
        subscriptionItems = [
          pickBy({
            id: submissionSubscriptionItem && submissionSubscriptionItem.id,
            plan: SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID
          }),
          pickBy({
            id: publicationSubscriptionItem && publicationSubscriptionItem.id,
            plan: SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID
          })
        ];
        // charge the activation fee
        if (SCIPE_EXPLORER_ACTIVATION_PRICE_USD) {
          await this.stripe.invoiceItems.create(
            {
              amount: SCIPE_EXPLORER_ACTIVATION_PRICE_USD * 100, // in cents
              currency: 'usd',
              customer: customer.id,
              description: 'One-time setup fee for sci.pe Explorer plan'
            },
            {
              idempotency_key: `invoice-${idempotencyKey}`
            }
          );
        }
        break;

      case SCIPE_VOYAGER_OFFER_ID:
        subscriptionItems = [
          pickBy({
            id: submissionSubscriptionItem && submissionSubscriptionItem.id,
            plan: SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID
          }),
          pickBy({
            id: publicationSubscriptionItem && publicationSubscriptionItem.id,
            plan: SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID
          })
        ];
        // charge the activation fee
        if (SCIPE_VOYAGER_ACTIVATION_PRICE_USD) {
          await this.stripe.invoiceItems.create(
            {
              amount: SCIPE_VOYAGER_ACTIVATION_PRICE_USD * 100, // in cents
              currency: 'usd',
              customer: customer.id,
              description: 'One-time setup fee for sci.pe Voyager plan'
            },
            {
              idempotency_key: `invoice-${idempotencyKey}`
            }
          );
        }
        break;
    }

    if (!subscription) {
      // create
      subscription = await this.stripe.subscriptions.create(
        {
          customer: customer.id,
          items: subscriptionItems,
          metadata: {
            organization: organizationId
          }
        },
        {
          idempotency_key: `create-subscription-${idempotencyKey}`
        }
      );
    } else {
      // update
      subscription = await this.stripe.subscriptions.update(
        subscription.id,
        {
          items: subscriptionItems
        },
        {
          idempotency_key: `update-subscription-${idempotencyKey}`
        }
      );
    }

    // Update the organization status (note that the web hook handler will take
    // care at of keeping that property up to date in case of failed payments)

    organization = await this.update(
      customer.metadata.organization,
      organization => {
        return Object.assign({}, organization, {
          customerAccountStatus:
            offerId === SCIPE_FREE_OFFER_ID
              ? 'PotentialCustomerAccountStatus'
              : 'ValidCustomerAccountStatus'
        });
      },
      { store }
    );

    const handledAction = setId(
      handleParticipants(
        Object.assign(
          {
            startTime: new Date().toISOString()
          },
          omit(prevActiveSubscribeAction, ['_rev']),
          action,
          prevActiveSubscribeAction
            ? { modifiedTime: new Date().toISOString() }
            : undefined, // required for idempotency_key TODO add to ontology
          {
            object: 'service:scipe',
            result: createId('stripe', subscription.id)['@id']
          }
        ),
        organization
      ),
      createId(
        'action',
        getId(prevActiveSubscribeAction) || action,
        getId(organization)
      )
    );

    var savedAction = await this.put(handledAction, { force: true, store });
  } catch (err) {
    throw err;
  } finally {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error(
        err,
        'could not unlock release lock, but will auto expire'
      );
    }
  }

  return Object.assign({}, savedAction, {
    result: Object.assign({ '@id': getId(savedAction.result) }, subscription)
  });
}
