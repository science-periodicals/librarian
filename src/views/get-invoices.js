import { getId, unprefix, arrayify, contextUrl } from '@scipe/jsonld';
import { convertStripeInvoiceToSchema } from '../utils/invoice-utils';

/**
 * See also `getUpcomingInvoice` to retrieve upcoming invoice
 */
export default function getInvoices(organizationId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const {
    store,
    fromCache = false,
    limit = 10,
    startingAfter, // an invoice @id (for pagination)
    baseUrl, // needed  if `format` is `SearchResultList`
    format = 'bare' // `SearchResultList`
  } = opts;

  this.getStripeCustomerByOrganizationId(
    getId(organizationId),
    { store, fromCache },
    (err, customer) => {
      if (err) return callback(err);

      this.stripe.invoices.list(
        {
          customer: customer.id,
          limit: limit || undefined,
          starting_after: unprefix(startingAfter) || undefined
        },
        (err, invoices) => {
          if (err) return callback(err);

          const schemaInvoices = arrayify(invoices.data).map(invoice =>
            convertStripeInvoiceToSchema(invoice, getId(organizationId))
          );

          let payload;
          if (format === 'SearchResultList') {
            payload = {
              '@context': contextUrl,
              '@type': 'SearchResultList',
              itemListElement: schemaInvoices.map((schemaInvoice, i) => {
                const item = {
                  '@type': 'ListItem',
                  item: schemaInvoice
                };

                if (
                  baseUrl &&
                  invoices.has_more &&
                  i === schemaInvoice.length - 1
                ) {
                  item.nextItem = `${baseUrl}?startingAfter=${unprefix(
                    getId(schemaInvoice)
                  )}`;
                }

                return item;
              })
            };
          } else {
            payload = schemaInvoices;
          }

          callback(null, payload);
        }
      );
    }
  );
}
