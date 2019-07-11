import { getId, unprefix } from '@scipe/jsonld';
import { convertStripeInvoiceToSchema } from '../utils/invoice-utils';

/**
 * See also `getUpcomingInvoice` to retrieve upcoming invoice
 */
export default function getInvoice(invoiceId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, fromCache = false } = opts;

  this.stripe.invoices.retrieve(unprefix(getId(invoiceId)), (err, invoice) => {
    if (err) return callback(err);

    // we need to get the organization related to the invoice
    this.getStripeObject(
      invoice.customer,
      { store, fromCache },
      (err, customer) => {
        if (err) return callback(err);
        const organizationId = getId(customer.metadata.organization);

        callback(null, convertStripeInvoiceToSchema(invoice, organizationId));
      }
    );
  });
}
