import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import remapRole from '../../utils/remap-role';
import handleParticipants from '../../utils/handle-participants';
import setId from '../../utils/set-id';
import createId from '../../create-id';
import { getObjectId, getAgentId } from '../../utils/schema-utils';

/**
 * Used to reject an `InviteAction` (`object`) by completing it and setting the
 * RejectAction as result of the `InviteAction`
 */
export default async function handleRejectInviteAction(
  action,
  inviteAction,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (inviteAction.actionStatus !== 'ActiveActionStatus') {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }. object must be an InviteAction in ActiveActionStatus status (got ${
        inviteAction.actionStatus
      })`
    );
  }

  // Validate agent
  if (getAgentId(action.agent) !== getAgentId(inviteAction.recipient)) {
    throw createError(
      403,
      `Invalid agent for ${
        action['@type']
      }. Agent must be compatible with the invite action recipient`
    );
  }

  const object = await this.get(getObjectId(inviteAction), {
    store,
    acl: false
  });

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(inviteAction.recipient, 'agent'),
          result: getId(inviteAction)
        }
      ),
      object
    ),
    createId('action', action, object)
  );

  const handledInviteAction = handleParticipants(
    Object.assign({}, inviteAction, {
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString(),
      // Note: we partially embedd the object has the user will loose access to the object => won't be able to see proper notification
      object: pick(object, [
        '@id',
        '@type',
        'name',
        'alternateName',
        'isPartOf',
        'publisher'
      ]),
      result: omit(handledAction, ['_id', '_rev']), // full RejectAction,
      // Note: we embed the RejectAction in the potential action so we know if invite was accepted or rejected for notification
      potentialAction: arrayify(inviteAction.potentialAction)
        .filter(action => getId(action) !== getId(handledAction))
        .concat(
          pick(handledAction, [
            '@id',
            '@type',
            'actionStatus',
            'startTime',
            'endTime'
          ])
        )
    }),
    object
  );

  // embed the accept action as potential action of the invite action for convenience

  const [savedAction, savedInviteAction] = await this.put(
    [handledAction, handledInviteAction],
    { force: true, store }
  );

  return Object.assign({}, savedAction, {
    result: savedInviteAction
  });
}
