import isPlainObject from 'lodash/isPlainObject';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import handleParticipants from '../../utils/handle-participants';
import setId from '../../utils/set-id';
import createId from '../../create-id';

export default async function handleUpdateStripeAccountAction(
  action,
  account,
  { store } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const upd = action.object;
  if (!isPlainObject(upd)) {
    throw createError(
      400,
      `Invalid object for ${action['@type']}. object must be an update payload`
    );
  }

  let organization = await this.get(getId(account.metadata.organization), {
    store,
    acl: false
  });

  const updatedAccount = await this.stripe.accounts.update(account.id, upd);

  organization = await this.update(
    organization,
    organization => {
      return Object.assign({}, organization, {
        canReceivePayment: !!updatedAccount.payouts_enabled
      });
    },
    { store }
  );

  const handledAction = setId(
    handleParticipants(
      Object.assign({}, action, {
        endTime: new Date().toISOString(),
        result: createId('stripe', updatedAccount.id, getId(organization))[
          '@id'
        ]
      }),
      organization
    ),
    createId('action', action, getId(organization))
  );

  const savedAction = await this.put(handledAction, { force: true, store });

  return Object.assign({}, savedAction, {
    result: Object.assign({ '@id': getId(savedAction.result) }, updatedAccount)
  });
}
