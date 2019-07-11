import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * Note: this returns a SubscribeAction (see notes on handle-subscribe-action.js for more info)
 */
export default function getActiveSubscribeAction(
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

  organizationId = getId(organizationId);

  this.view.get(
    {
      url: '/activeSubscriptionByOrganizationId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify(organizationId)
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const docs = getDocs(body);

      if (docs.length === 0) {
        // Check that the view had the latest data (CouchDB 2.x & eventual consistency)
        this.hasActiveSubscribeActionId(organizationId, (err, hasUniqId) => {
          if (hasUniqId) {
            return callback(
              createError(
                503,
                `All the documents related to ${organizationId} haven't been replicated to the server yet, please try again later`
              )
            );
          }

          return callback(
            createError(404, `No active SubscribeAction for ${organizationId}`)
          );
        });
      } else if (docs.length > 1) {
        return callback(
          createError(
            500,
            `more than 1 active SubscribeAction for ${organizationId}`
          )
        );
      } else {
        return callback(null, docs[0]);
      }
    }
  );
}
