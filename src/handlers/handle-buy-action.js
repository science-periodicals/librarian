import createError from '@scipe/create-error';
import { getObjectId } from '../utils/schema-utils';
import handleBuyTypesettingAction from './sub-handlers/handle-buy-typesetting-action';

export default async function handleBuyAction(
  action = {},
  { store, triggered, skipPayments } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const offerId = getObjectId(action);
  if (!offerId) {
    throw createError(400, 'BuyAction need a valid object (Offer).');
  }

  const service = await this.getServiceByOfferId(offerId, { store });
  if (!service) {
    throw createError(400, 'BuyAction need a valid object (Offer).');
  }

  switch (service.serviceType) {
    case 'typesetting':
      return handleBuyTypesettingAction.call(this, action, service, {
        store,
        triggered,
        skipPayments
      });

    default:
      throw createError(
        400,
        `${service['@type']} of serviceType ${
          service.serviceType
        } can't be purchased`
      );
  }
}
