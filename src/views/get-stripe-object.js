import { unprefix } from '@scipe/jsonld';

export default function getStripeObject(stripeId, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store, type = 'any' } = opts;

  stripeId = unprefix(stripeId);

  switch (type) {
    case 'account':
      this.stripe.accounts.retrieve(stripeId, callback);
      break;

    case 'customer':
      this.stripe.customers.retrieve(stripeId, callback);
      break;

    case 'subscription':
      this.stripe.subscriptions.retrieve(stripeId, callback);
      break;

    default:
      // either account, customer or subscription. we try everything
      this.stripe.accounts.retrieve(stripeId, (errAccount, account) => {
        if (errAccount || !account) {
          this.stripe.customers.retrieve(stripeId, (errCustomer, customer) => {
            if (errCustomer || !customer) {
              this.stripe.subscriptions.retrieve(
                stripeId,
                (errSubscription, subscription) => {
                  if (errSubscription || !subscription) {
                    return callback(
                      errSubscription || errCustomer || errAccount
                    );
                  }
                  callback(null, subscription);
                }
              );
            } else {
              callback(null, customer);
            }
          });
        } else {
          callback(null, account);
        }
      });
      break;
  }
}
