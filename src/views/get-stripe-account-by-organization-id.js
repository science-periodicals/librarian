import createError from '@scipe/create-error';
import { unprefix, getId } from '@scipe/jsonld';

export default function getStripeAccountByOrganizationId(
  organizationId,
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.getActionsByObjectIdAndType(
    getId(organizationId),
    'CreatePaymentAccountAction',
    { store },
    (err, actions) => {
      if (err) return callback(err);

      const action = actions[0];
      if (!action) {
        // Check that the view had the latest data (CouchDB 2.x & eventual consistency)
        this.hasCreatePaymentAccountActionId(
          organizationId,
          (err, hasUniqId) => {
            if (hasUniqId) {
              return callback(
                createError(
                  503,
                  `All the documents related to ${organizationId} haven't been replicated to the server yet, please try again later`
                )
              );
            }

            return callback(
              createError(404, `Not stripe account found for ${organizationId}`)
            );
          }
        );
      } else {
        const accountId = unprefix(getId(action.result));

        this.stripe.accounts.retrieve(accountId, callback);
      }
    }
  );
}
