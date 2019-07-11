import { arrayify, unprefix, getId } from '@scipe/jsonld';
import {
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID,
  CONTACT_POINT_ADMINISTRATION
} from '../constants';

/**
 * Handle stripe event as sent by Stripe webhooks (see https://stripe.com/docs/webhooks#responding-to-a-webhook and https://stripe.com/docs/billing/webhooks)
 * This function returns an HTTP status code or throw an error
 *
 * Note: see https://dashboard.stripe.com/account/recurring for the retry rules (we want smart retries then finally cancel the subscription)
 * Note: This is the _only_ place where we can update the organization `customerAccountStatus` property (this is used by the app-suite to know if the journal can accept submissions)
 * Note: webhook signature (https://stripe.com/docs/webhooks/signatures) are checked at the API level
 */
export default async function handleStripeEvent(event) {
  this.log.info({ event }, 'handleStripeEvent (stripe webhook)');

  switch (event.type) {
    case 'account.updated': {
      // See https://stripe.com/docs/recipes/identity-verification-notifications-for-custom-accounts
      const account = event.data.object;

      let organization = await this.get(account.metadata.organization, {
        acl: false
      });

      // keep canReceivePayment up-to-date
      const nextCanReceivePayment = !!account.payouts_enabled;
      if (nextCanReceivePayment !== organization.canReceivePayment) {
        try {
          organization = await this.update(organization, organization => {
            return Object.assign({}, organization, {
              canReceivePayment: nextCanReceivePayment
            });
          });
        } catch (err) {
          this.log.error(
            { err, organization, event, account },
            'Stripe event from webhook: could not sent email'
          );
        }
      }

      if (arrayify(account.verification.fields_needed).length) {
        const emailMessage = {
          '@type': 'EmailMessage',
          recipient: arrayify(organization.contactPoint).find(
            contactPoint =>
              contactPoint.contactType === CONTACT_POINT_ADMINISTRATION
          ),
          // prettier-ignore
          description: `[sci.pe] Please update your organization "${unprefix(getId(organization))}" payment account information`,
          // prettier-ignore
          text: {
            '@type': 'rdf:HTML',
            '@value': `<p>Hi there,</p>
<p>
  We need some additional information about your organization "${unprefix(getId(organization))}" payment account
  to continue sending you payouts.
</p>
<p>
  You can get this to us by following the link here:
  https://sci.pe/settings/organization/${unprefix(getId(organization))}/payments
<p>`
          }
        };

        try {
          await this.sendEmail(emailMessage);
        } catch (err) {
          this.log.error(
            { err, emailMessage, event, account },
            'Stripe event from webhook: could not sent email'
          );
        }
      }
      return 200;
    }

    case 'customer.subscription.created': {
      // If plan is not free set organization `customerAccountStatus` to `ValidCustomerAccountStatus`
      const subscription = event.data.object;
      if (!isOnFreePlan(subscription)) {
        await this.update(subscription.metadata.organization, organization => {
          return Object.assign({}, organization, {
            customerAccountStatus: 'ValidCustomerAccountStatus'
          });
        });
      }
      return 200;
    }

    case 'invoice.payment_succeeded': {
      // if plan is not free set organization customerAccountStatus to ValidCustomerAccountStatus
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const customer = await this.getStripeObject(customerId);
      const subscription = await this.getStripeObject(invoice.subscription);

      if (!isOnFreePlan(subscription)) {
        await this.update(customer.metadata.organization, organization => {
          return Object.assign({}, organization, {
            customerAccountStatus: 'ValidCustomerAccountStatus'
          });
        });
      }

      // TODO email to notify that invoice is available online

      return 200;
    }

    case 'invoice.payment_failed': {
      // See https://stripe.com/docs/api#invoice_object
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const customer = await this.getStripeObject(customerId);
      const organization = await this.get(customer.metadata.organization, {
        acl: false
      });

      let next_payment_attempt;
      if (invoice.next_payment_attempt) {
        next_payment_attempt = new Date(
          invoice.next_payment_attempt
        ).toISOString();
      }

      // Text adapted from https://stripe.com/docs/recipes/sending-emails-for-failed-payments#sending-notification-emails
      const emailMessage = {
        '@type': 'EmailMessage',
        recipient: arrayify(organization.contactPoint).find(
          contactPoint =>
            contactPoint.contactType === CONTACT_POINT_ADMINISTRATION
        ),
        // prettier-ignore
        description: `[sci.pe] Your most recent invoice payment for the organization "${unprefix(getId(organization))}" failed`,
        // prettier-ignore
        text: {
          '@type': 'rdf:HTML',
          '@value': `<p>Hi there,</p>
<p>
  Unfortunately, your most recent invoice payment for ${invoice.amount_due} was declined.
  This could be due to a change in your card number, your card expiring,
  cancellation of your credit card, or the card issuer not recognizing the
  payment and therefore taking action to prevent it.
</p>
</p>
  ${next_payment_attempt ? `The next attempt will be made on ${next_payment_attempt}.`: 'No further attempt will be made and your account will be disabled until your update your payment information.'}
</p>
<p>
  Please update your payment information as soon as possible by following the link here:
  https://sci.pe/settings/organization/${unprefix(getId(organization))}/payments
<p>`
        }
      };

      try {
        await this.sendEmail(emailMessage);
      } catch (err) {
        this.log.error(
          { err, emailMessage, event, customer },
          'Stripe event from webhook: could not sent email'
        );
      }

      // Update the organization status
      if (!next_payment_attempt) {
        await this.update(customer.metadata.organization, organization => {
          return Object.assign({}, organization, {
            customerAccountStatus: 'InvalidCustomerAccountStatus'
          });
        });
      }

      return 200;
    }

    case 'customer.subscription.deleted':
      // see https://stripe.com/docs/billing/lifecycle#inactive
      // if event.request is null => stripe canceled the subscription => we mark the SubscribeAction in FailedActionStatus (that will invalidate the lock and allow the user to create a new subscription) and set the organization customerAccountStatus to PotentialCustomerAccountStatus
      // Note the SubscribeAction can end up being in CompletedActionStatus if the customer pay all the past unpaid invoices
      if (event.request === null) {
        const subscription = event.data.object;
        const organizationId = subscription.metadata.organization;

        const subscribeAction = await this.getActiveSubscribeAction(
          organizationId
        );
        await this.update(subscribeAction, subscribeAction => {
          return Object.assign(
            {
              endTime: new Date().toISOString()
            },
            subscribeAction,
            {
              actionStatus: 'FailedActionStatus',
              error: {
                '@type': 'Error',
                description:
                  'Subscription was terminated after unsuccessful payment'
              }
            }
          );
        });

        if (!isOnFreePlan(subscription)) {
          await this.update(organizationId, organization => {
            return Object.assign({}, organization, {
              customerAccountStatus: 'PotentialCustomerAccountStatus'
            });
          });
        }
      }
      return 200;

    default:
      return 200;
  }
}

function isOnFreePlan(subscription) {
  return arrayify(subscription.items && subscription.items.data).every(
    item =>
      !item.plan ||
      (item.plan.id !== SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID &&
        item.plan.id !== SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID &&
        item.plan.id !== SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID &&
        item.plan.id !== SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID)
  );
}
