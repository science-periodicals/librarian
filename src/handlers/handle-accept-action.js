import createError from '@scipe/create-error';
import { getObjectId } from '../utils/schema-utils';
import handleAcceptInviteAction from './sub-handlers/handle-accept-invite-action';
import handleAcceptApplyAction from './sub-handlers/handle-accept-apply-action';

/**
 * Used to accept an `InviteAction` or an `ApplyAction` (the `object`)
 */
export default async function handleAcceptAction(
  action,
  { store, triggered, prevAction } = {}
) {
  let object;
  try {
    object = await this.get(getObjectId(action), {
      store,
      acl: false
    });
  } catch (err) {
    if (err.code !== 404) {
      throw err;
    }

    throw createError(400, `${action['@type']}: could not find object`);
  }

  switch (object['@type']) {
    case 'InviteAction':
      return handleAcceptInviteAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    case 'ApplyAction':
      return handleAcceptApplyAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    default:
      throw createError(
        400,
        `Invalid object for ${
          action['@type']
        }. object must be an InviteAction or an ApplyAction`
      );
  }
}
