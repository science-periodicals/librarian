import { getId } from '@scipe/jsonld';
import { convertStripeInvoiceToSchema } from '../utils/invoice-utils';

/**
 * See also `getInvoices` to retrieve past invoices
 */
export default function getUpcomingInvoice(organizationId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache = false } = opts;

  this.getStripeCustomerByOrganizationId(
    getId(organizationId),
    { store, fromCache },
    (err, customer) => {
      if (err) return callback(err);

      this.stripe.invoices.retrieveUpcoming(customer.id, (err, invoice) => {
        if (err) return callback(err);

        callback(
          null,
          convertStripeInvoiceToSchema(invoice, getId(organizationId))
        );
      });
    }
  );
}
