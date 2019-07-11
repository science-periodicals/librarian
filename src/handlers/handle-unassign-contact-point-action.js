import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getContactPointUserId } from '../utils/contact-point-utils';
import handleParticipants from '../utils/handle-participants';
import { getObject } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import setId from '../utils/set-id';
import createId from '../create-id';

/**
 * Unassign an existing contact point (object of the action) to the action
 * `recipient` (Role of a Periodical or Graph or an Organization)
 */
export default async function handleUnassignContactPointAction(
  action,
  { store, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const contactPoint = getObject(action);
  if (!contactPoint) {
    throw createError(
      400,
      `Invalid object for ${action['@type']}, object must be a ContactPoint`
    );
  }

  const userId = getContactPointUserId(contactPoint);
  if (!userId) {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }, object must point to a valid ContactPoint`
    );
  }

  const profile = await this.get(userId, {
    acl: false,
    store
  });

  const sourceContactPoint = arrayify(profile.contactPoint).find(
    _contactPoint => getId(_contactPoint) === getId(contactPoint)
  );
  if (!sourceContactPoint) {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }, contact point can't be found in ${getId(profile)}`
    );
  }

  const recipientId = getId(action.recipient);
  if (!recipientId || !recipientId.startsWith('role:')) {
    throw createError(
      400,
      `Invalid recipient for ${
        action['@type']
      }, recipient must be a Role from a Graph, Periodical or Organization`
    );
  }

  // scope is a Graph, Periodical or Organization
  const scope = await this.getEmbedderByEmbeddedId(recipientId, { store });
  const sourceRole = findRole(action.recipient, scope, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceRole) {
    throw createError(
      400,
      `Invalid recipient for ${
        action['@type']
      }, recipient cannot be found in ${getId(scope)}`
    );
  }

  const updatedScope = await this.update(
    scope,
    scope => {
      const sourceRole = findRole(action.recipient, scope, {
        ignoreEndDateOnPublicationOrRejection: true
      });
      if (sourceRole) {
        sourceRole.roleContactPoint = arrayify(
          sourceRole.roleContactPoint
        ).filter(
          contactPoint => getId(contactPoint) !== getId(sourceContactPoint)
        );

        if (!sourceRole.roleContactPoint.length) {
          delete sourceRole.roleContactPoint;
        }
      }

      return scope;
    },
    { store }
  );

  const handledAction = setId(
    handleParticipants(
      Object.assign({ startTime: new Date().toISOString() }, action, {
        endTime: new Date().toISOString(),
        result: getId(updatedScope)
      })
    ),
    createId('action', action, scope)
  );

  const savedAction = await this.put(handledAction, {
    force: true,
    store
  });

  return Object.assign({}, savedAction, { result: updatedScope });
}
