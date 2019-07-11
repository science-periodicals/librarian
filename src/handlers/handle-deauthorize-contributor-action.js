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
 * `agent` deauthorize `recipient` from the `object` (Graph, Periodical or Organization)
 *
 * !! We do _not_ remove them but set their `endDate`
 *
 * Note: we allow to remove the last contributor for every
 * object as we still have the `creator` or `founder` info
 */
export default async function handleDeauthorizeContributorAction(
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

  // validate agent;
  const sourceAgent = findRole(action.agent, object);
  // For Graphs, the agent must be a Role (so that we can preserve anonymity)
  if (!sourceAgent && object['@type'] === 'Graph') {
    throw createError(
      400,
      `${action['@type']} agent must be a valid object (${getId(object)}) Role`
    );
  }
  const handledAgent = sourceAgent
    ? remapRole(sourceAgent, 'agent', { dates: false })
    : getAgentId(action.agent);

  // validate recipient
  const role = findRole(action.recipient, object);
  if (!role && object['@type'] === 'Graph') {
    throw createError(
      400,
      `Invalid agent for ${
        action['@type']
      }, agent must be an existing role of ${getId(object)}`
    );
  }

  const handledRecipient = role
    ? remapRole(role, 'recipient', { dates: false })
    : getAgentId(action.recipient);

  const savedObject = await this.update(
    object,
    object => {
      if (role) {
        return endRole(role, object);
      }

      // Not a role, any role involving the user is terminated
      const userId = getAgentId(action.recipient);
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
          agent: handledAgent,
          recipient: handledRecipient,
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
