import createError from '@scipe/create-error';
import { getId, arrayify, getNodeMap, textify } from '@scipe/jsonld';
import { getObjectId, getResultId, getParts } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import {
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  DOI_REGISTRATION_SERVICE_TYPE
} from '../constants';

/**
 * Add invoice item to explorer subscription for brokered service fee (Typesetting)
 * and `addOnService` (DOIs registration etc.)
 * See https://stripe.com/docs/billing/invoices/subscription#adding-upcoming-invoice-items
 */
export default async function createInvoiceItem(
  action, // a handled action (with _id etc.) _before_ it is saved to the DB so that invoicing can be retried
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
    case 'BuyAction': {
      const offerId = getObjectId(action);
      const service = await this.getServiceByOfferId(offerId, {
        store,
        fromCache: true
      });

      // we only invoice for brokered service
      if (!service.brokeredService) {
        return;
      }

      const offer = arrayify(service.offers)
        .concat(arrayify(service.offers.addOn))
        .find(offer => getId(offer) === offerId);

      // Note: for now brokered service are only provided by sci.pe
      const brokeredService = await this.get(getId(service.brokeredService), {
        acl: false,
        store
      });

      const brokeredOffer = arrayify(brokeredService.offers)
        .concat(arrayify(brokeredService.offers.addOn))
        .find(
          brokeredOffer =>
            brokeredOffer.eligibleCustomerType === offer.eligibleCustomerType
        );

      if (!brokeredOffer) {
        throw createError(
          500,
          `createInvoiceItem: could not find brokered offer for ${getId(
            offer
          )} ${getId(service)} ${getId(brokeredService)}`
        );
      }

      // See https://stripe.com/docs/api/invoiceitems/create
      const { price, priceCurrency = 'USD' } = brokeredOffer.priceSpecification;
      if (price > 0) {
        // we need to get the org to find the stripe customer and subscription id
        const graph = await this.get(getScopeId(action), { acl: false, store });
        const organizationId = getId(graph.publisher);
        const customer = await this.getStripeCustomerByOrganizationId(
          organizationId,
          { store }
        );
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

        // we only charge for explorer
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

        const resp = await this.stripe.invoiceItems.create(
          {
            customer: customer.id,
            amount: price * 100, // stripe requires price to be in _cents_
            currency: priceCurrency.toLowerCase(),
            subscription: subscription.id,
            description: textify(brokeredService.name),
            metadata: {
              timestamp,
              orderId: getResultId(action),
              actionId: getId(action),
              offerId: getId(offer),
              brokeredOfferId: getId(brokeredOffer),
              serviceId: getId(brokeredService) // used for invoice (`orderedItem`)
            }
          },
          {
            // !! action['@id'] is not guaranteed to be stable on retries
            idempotency_key: `${action['@type']}-${getId(
              action.instrumentOf
            )}-${getId(brokeredOffer)}`
          }
        );

        this.log.debug(
          { action, stripeResp: resp },
          'createInvoiceItem added invoice item'
        );
      }

      break;
    }

    case 'PublishAction': {
      // handle addOnService (DOI registration)
      if (action.addOnService) {
        // we need to get the org to find the stripe customer and subscription id
        const graph = await this.get(getScopeId(action), {
          acl: false,
          store
        });
        const organizationId = getId(graph.publisher);
        const customer = await this.getStripeCustomerByOrganizationId(
          organizationId,
          { store }
        );
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

        // we only charge for explorer
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

        for (const addOnService of arrayify(action.addOnService)) {
          const service = await this.get(addOnService, { acl: false, store });
          if (service) {
            const offer = addOnService.offers;

            // For now we only handle DOI registration services
            switch (service.serviceType) {
              case DOI_REGISTRATION_SERVICE_TYPE: {
                const nodeMap = getNodeMap(graph);
                const mainEntity = nodeMap[getId(graph.mainEntity)];
                if (mainEntity && mainEntity.doi) {
                  const nPartsWithDoi = getParts(mainEntity, nodeMap).filter(
                    node => node.doi
                  ).length;

                  const priceSpecificationMainEntity = arrayify(
                    offer.priceSpecification &&
                      offer.priceSpecification.priceComponent
                  ).find(
                    priceComponent => priceComponent.nane === 'main entity'
                  );
                  const priceSpecificationParts = arrayify(
                    offer.priceSpecification &&
                      offer.priceSpecification.priceComponent
                  ).find(
                    priceComponent => priceComponent.nane === 'main entity'
                  );

                  if (
                    !priceSpecificationMainEntity ||
                    !priceSpecificationParts
                  ) {
                    throw createError(
                      500,
                      `Invalid offer for service ${getId(
                        service
                      )}. priceSpecification should have price component for component "main entity" and "part"`
                    );
                  }

                  const totalPrice =
                    (priceSpecificationMainEntity.price || 0) * 1 +
                    (priceSpecificationParts.price || 0) * nPartsWithDoi;

                  if (totalPrice > 0) {
                    const resp = await this.stripe.invoiceItems.create(
                      {
                        customer: customer.id,
                        amount: totalPrice * 100, // stripe requires price to be in _cents_
                        currency: (
                          priceSpecificationMainEntity.priceCurrency || 'USD'
                        ).toLowerCase(),
                        subscription: subscription.id,
                        description: textify(service.name),
                        metadata: {
                          timestamp,
                          actionId: getId(action),
                          offerId: getId(offer),
                          serviceId: getId(service) // used for invoice (`orderedItem`)
                        }
                      },
                      {
                        idempotency_key: `${getId(action)}-${getId(service)}`
                      }
                    );

                    this.log.debug(
                      { action, addOnService, stripeResp: resp },
                      'createInvoiceItem added invoice item'
                    );
                  }
                }
                break;
              }

              default:
                break;
            }
          }
        }
      }
      break;
    }

    default:
      break;
  }
}
