import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';
import setId from '../utils/set-id';

/**
 * Used so that Organizations can receive payments (from APCs and author services)
 * Note account info must be specified via account tokens: see https://stripe.com/docs/connect/account-tokens
 * `object` is the Organization @id
 * `result` will become a stripe account id prefixed with `stripe:`
 */
export default async function handeCreatePaymentAccountAction(
  action,
  { store } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const organizationId = getObjectId(action);
  let organization = await this.get(organizationId, { acl: false, store });

  const lock = await this.createLock(getId(organization), {
    isLocked: async () => {
      try {
        // Note: this view is safe wrt eventual consistency
        var account = await this.getStripeAccountByOrganizationId(
          getId(organization)
        );
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }
      return !!account;
    },
    prefix: 'stripe:accounts'
  });

  try {
    var account = await this.stripe.accounts.create(
      Object.assign(
        pick(action.result, ['country', 'account_token', 'external_account']),
        {
          type: 'custom',
          metadata: {
            organization: getId(organization)
          }
        }
      )
    );

    const handledAction = setId(
      handleParticipants(
        Object.assign(
          {
            startTime: new Date().toISOString()
          },
          action,
          {
            object: getId(organization),
            endTime: new Date().toISOString(),
            result: createId('stripe', account.id)['@id']
          }
        ),
        organization
      ),
      createId('action', action, getId(organization))
    );

    organization = await this.update(
      organization,
      organization => {
        return Object.assign({}, organization, {
          canReceivePayment: !!account.payouts_enabled
        });
      },
      { store }
    );

    var savedAction = await this.put(handledAction, { force: true, store });
  } catch (err) {
    throw err;
  } finally {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error(
        err,
        'could not unlock release lock, but will auto expire'
      );
    }
  }

  return Object.assign({}, savedAction, {
    result: Object.assign({ '@id': getId(savedAction.result) }, account)
  });
}
