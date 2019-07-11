import moment from 'moment';
import { getId, arrayify } from '@scipe/jsonld';
import createId from '../create-id';
import {
  SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID
} from '../constants';

// See https://stripe.com/docs/api/invoices/object
export function convertStripeInvoiceToSchema(invoice, organizationId) {
  return {
    '@id': invoice.id ? `invoice:${invoice.id}` : createId('blank')['@id'],
    '@type': 'Invoice',
    identifier: invoice.number,
    customer: getId(organizationId),
    provider: 'org:scipe',
    billingPeriod: moment
      .duration(invoice.period_end - invoice.period_start, 'seconds')
      .toISOString(),
    paymentDueDate: new Date(invoice.period_end * 1000).toISOString(),
    paymentStatus: !invoice.attempted
      ? 'PaymentDue'
      : invoice.paid || invoice.status === 'paid'
      ? 'PaymentComplete'
      : invoice.status === 'open' &&
        invoice.attempt_count &&
        invoice.attempt_count > 1
      ? 'PaymentPastDue'
      : 'PaymentDeclined',
    totalPaymentDue: {
      '@type': 'PriceSpecification',
      price: invoice.amount_due / 100, // stripe ammounts for SA subscriptions are in cents and USD
      priceCurrency: invoice.currency
    },
    referencesOrder: arrayify(invoice.lines && invoice.lines.data).map(line => {
      let description = line.description;
      if (line.plan) {
        switch (line.plan.id) {
          case SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID:
            description = 'sci.pe free (submission)';
            break;
          case SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID:
            description = 'sci.pe free (publication)';
            break;
          case SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID:
            description = 'sci.pe explorer (submission)';
            break;
          case SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID:
            description = 'sci.pe explorer (publication)';
            break;
          case SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID:
            description = 'sci.pe voyager (submission)';
            break;
          case SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID:
            description = 'sci.pe voyager (publication)';
            break;
        }
      }

      return {
        '@id': `order:${line.id}`,
        '@type': 'OrderItem',
        description,
        orderQuantity: line.quantity,
        // TODO? `orderAmount` add to ontology
        orderAmount: {
          '@type': 'PriceSpecification',
          price: line.amount / 100, // stripe ammounts for SA subscriptions are in cents and USD
          priceCurrency: line.currency
        },
        orderedItem: line.plan ? 'service:scipe' : line.metadata.serviceId
      };
    })
  };
}
