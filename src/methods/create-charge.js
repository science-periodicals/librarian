import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import { getResultId, getObjectId } from '../utils/schema-utils';
import {
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_TAXE_FRACTION
} from '../constants';

/**
 * Create charge allow organization to charge authors or pay reviewers
 * Create charge and take the sci.pe tax when applicable
 * See https://stripe.com/docs/connect/destination-charges#transfer-amount
 */
export default async function createCharge(
  action, // an handled action (with _id etc.) _before_ it is saved to the DB so that charge can be retried
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
    case 'PayAction': {
      // Always take SA tax on explorer
      const { price, priceCurrency = 'USD' } = action.priceSpecification;
      const effectivePrice =
        'requestedPrice' in action ? action.requestedPrice : price;

      if (effectivePrice > 0) {
        // get the organization to get the stripe account and subscription
        const graph = await this.get(getScopeId(action), { acl: false, store });
        const organizationId = getId(graph.publisher);
        const subscribeAction = await this.getActiveSubscribeAction(
          organizationId,
          { store }
        );
        const subscription = await this.getStripeObject(
          getResultId(subscribeAction),
          {
            store,
            type: 'subscription'
          }
        );
        const account = await this.getStripeAccountByOrganizationId(
          organizationId,
          { store }
        );

        // we only take taxe on explorer
        const takeTax = subscription.items.data.some(
          data =>
            (data.plan &&
              data.plan.id === SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID) ||
            (data.plan &&
              data.plan.id === SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID)
        );

        const resp = await this.stripe.charges.create(
          {
            amount: effectivePrice * 100, // total amount (in cents)
            currency: priceCurrency.toLowerCase(),
            source: action.paymentToken.value,
            statement_descriptor: 'sci. APC', // limited to 22 characters
            transfer_data: takeTax
              ? {
                  amount: Math.ceil(
                    effectivePrice * 100 * (1 - SCIPE_EXPLORER_TAXE_FRACTION)
                  ), // `amount` specifies the fraction that the org will receive
                  destination: account.id
                }
              : { destination: account.id },
            metadata: {
              actionId: getId(action)
            }
          },
          {
            idempotency_key: `${getId(action)}`
          }
        );

        this.log.debug(
          { action, stripeResp: resp },
          'createCharge created a chearge'
        );
      }
      break;
    }

    case 'BuyAction': {
      // only take SA tax on explorer if no brokered service or, in case of
      // brokered service only take in on the remainder of (fee - brokered service
      // fee) if that remainder is positive

      const offerId = getObjectId(action);
      const service = await this.getServiceByOfferId(offerId, {
        store,
        fromCache: true
      });

      const offer = arrayify(service.offers)
        .concat(arrayify(service.offers.addOn))
        .find(offer => getId(offer) === offerId);

      const { price, priceCurrency = 'USD' } = offer.priceSpecification;
      if (price > 0) {
        // get the organization to get the stripe account and subscription
        const graph = await this.get(getScopeId(action), { acl: false, store });
        const organizationId = getId(graph.publisher);
        const subscribeAction = await this.getActiveSubscribeAction(
          organizationId,
          { store }
        );
        const subscription = await this.getStripeObject(
          getResultId(subscribeAction),
          {
            store,
            type: 'subscription'
          }
        );
        const account = await this.getStripeAccountByOrganizationId(
          organizationId,
          { store }
        );

        // we only take taxe on explorer
        const takeTax = subscription.items.data.some(
          data =>
            (data.plan &&
              data.plan.id === SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID) ||
            (data.plan &&
              data.plan.id === SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID)
        );

        // we only take tax if grossProfit is > 0
        let grossProfit = price;
        if (takeTax && service.brokeredService) {
          const brokeredService = await this.get(
            getId(service.brokeredService),
            {
              acl: false,
              store
            }
          );

          const brokeredOffer = arrayify(brokeredService.offers)
            .concat(arrayify(brokeredService.offers.addOn))
            .find(
              brokeredOffer =>
                brokeredOffer.eligibleCustomerType ===
                offer.eligibleCustomerType
            );

          if (!brokeredOffer) {
            throw createError(
              500,
              `createInvoiceItem: could not find brokered offer for ${getId(
                offer
              )} ${getId(service)} ${getId(brokeredService)}`
            );
          }

          grossProfit = price - brokeredOffer.priceSpecification.price;
        }

        const resp = await this.stripe.charges.create(
          {
            amount: price * 100, // total amount (in cents)
            currency: priceCurrency.toLowerCase(),
            source: action.paymentToken.value,
            statement_descriptor: 'sci. author service', // limited to 22 characters
            transfer_data:
              takeTax && grossProfit > 0
                ? {
                    // `amount` specifies the fraction that the org will receive, we only take a cut on the gross profit
                    // prettier-ignore
                    amount:
                  (price - Math.floor(grossProfit * SCIPE_EXPLORER_TAXE_FRACTION)) * 100,
                    destination: account.id
                  }
                : { destination: account.id },
            metadata: {
              actionId: getId(action)
            }
          },
          {
            // !! action['@id'] is not guaranteed to be stable on retries
            idempotency_key: `${action['@type']}-${getId(
              action.instrumentOf
            )}-${getId(offer)}`
          }
        );

        this.log.debug(
          { action, stripeResp: resp },
          'createCharge created a charge'
        );
      }
      // statement_descriptor: 'sci. author service'
      break;
    }

    case 'ReviewAction': {
      // Paid review action
      // TODO (no SA tax) charge from customer default source to user (reviewer
      // stripe account) + use on_behalf_of: set to the reviewer stripe account so
      // that it looks like the reviewer did the charge and not SA

      // NOTE need new "outgoing payment" UI as this is different from invoice or incoming payments

      // resp = await this.stripe.charges.create(
      //   {
      //     amount: 2000, // in cents
      //     currency: 'usd',
      //     customer: customer.id,
      //     source: customer.default_source, // the org customer
      //     description: 'Reviewer payment',
      //     transfer_data: {
      //       destination: account.id // the reviewer account
      //     },
      //     metadata: {
      //       actionId: getId(action)
      //     }
      //   },
      //   {
      //     idempotency_key: getId(action)
      //   }
      // );
      //
      // this.log.debug(
      //   { action, stripeResp: resp },
      //   'createCharge created a charge'
      // );

      break;
    }

    default:
      break;
  }
}
