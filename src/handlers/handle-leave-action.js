import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import setId from '../utils/set-id';
import { endRole, endUserRoles } from '../utils/role-utils';
import { getObjectId, getAgentId } from '../utils/schema-utils';

/**
 * user can leave a Periodical, a Graph or an Organziation.
 * !! We do _not_ remove them but set their endDate
 *
 * Note: we allow to remove the last contributor for every
 *  object as we still have the `creator` or `founder` info
 */
export default async function handleLeaveAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  // get and validate object
  const object = await this.get(getObjectId(action), {
    store,
    acl: false
  });
  if (
    !object ||
    (object['@type'] !== 'Graph' &&
      object['@type'] !== 'Periodical' &&
      object['@type'] !== 'Organization') ||
    object.version != null
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } must have an object pointing to a Graph, Periodical, or Organization`
    );
  }

  // validate agent
  const role = findRole(action.agent, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!role && object['@type'] === 'Graph') {
    throw createError(
      400,
      `Invalid agent for ${
        action['@type']
      }, agent must be an existing role of ${getId(object)}`
    );
  }

  const savedObject = await this.update(
    object,
    object => {
      if (role) {
        return endRole(role, object);
      }

      // Not a role, any role involving the user is terminated
      const userId = getAgentId(action.agent);
      if (userId && userId.startsWith('user:')) {
        return endUserRoles(userId, object);
      }

      return object;
    },
    { store }
  );

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(role, 'agent', { dates: false }),
          result: getId(savedObject)
        }
      ),
      savedObject
    ),
    createId('action', action, savedObject)
  );

  const savedAction = await this.put(handledAction, { force: true, store });

  await this.syncParticipants(savedObject, { store });

  return Object.assign({}, savedAction, { result: savedObject });
}
