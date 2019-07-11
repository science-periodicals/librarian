import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, unprefix } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';
import setId from '../utils/set-id';

/**
 * Note: Customer can be created with a source (valid payment method) specified in the action `result`
 */
export default async function handleCreateCustomerAccountAction(
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
  const organization = await this.get(organizationId, { acl: false, store });

  const lock = await this.createLock(getId(organization), {
    isLocked: async () => {
      try {
        // Note this view is safe wrt eventual consistency
        var customer = await this.getStripeCustomerByOrganizationId(
          getId(organization),
          { store }
        );
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }
      return !!customer;
    },
    prefix: 'stripe:customers'
  });

  try {
    var customer = await this.stripe.customers.create(
      Object.assign(pick(action.result, ['source']), {
        name: unprefix(organizationId),
        description: `sci.pe customer account for ${organizationId}`,
        metadata: {
          organization: getId(organization)
        }
      })
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
            result: createId('stripe', customer.id)['@id']
          }
        ),
        organization
      ),
      createId('action', action, getId(organization))
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
    result: Object.assign({ '@id': getId(savedAction.result) }, customer)
  });
}
