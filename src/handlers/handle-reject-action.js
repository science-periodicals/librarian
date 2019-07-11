import createError from '@scipe/create-error';
import handleRejectInviteAction from './sub-handlers/handle-reject-invite-action';
import handleRejectApplyAction from './sub-handlers/handle-reject-apply-action';
import { getObjectId } from '../utils/schema-utils';

/**
 * Used to reject an `InviteAction` or an `ApplyAction` (`object`) by completing it and setting the
 * RejectAction as result of the `InviteAction` or `ApplyAction`
 */
export default async function handleRejectAction(
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
      return handleRejectInviteAction.call(this, action, object, {
        store,
        triggered,
        prevAction
      });

    case 'ApplyAction':
      return handleRejectApplyAction.call(this, action, object, {
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
