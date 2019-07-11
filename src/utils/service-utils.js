import flatten from 'lodash/flatten';
import { arrayify } from '@scipe/jsonld';

/**
 * For now services have only 1 offer but that offer can have an `addOn` offer
 * This function return the eligible offer for a given `CustomerType`
 */
export function getEligibleOffer(
  service = {},
  customerType = 'Enduser' // or `RevisionAuthor`
) {
  const offers = flatten(
    arrayify(service.offers).concat(
      arrayify(service.offers).map(offer => arrayify(offer && offer.addOn))
    )
  ).filter(Boolean);

  return offers.find(
    offer =>
      offer.eligibleCustomerType === customerType ||
      (customerType === 'Enduser' && !offer.eligibleCustomerType)
  );
}
