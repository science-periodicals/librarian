import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId, unrole, arrayify, unprefix, reUuid } from '@scipe/jsonld';
import { getObjectId, getRootPartId, getAgentId } from '../utils/schema-utils';
import { isRole } from '../validators';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import setId from '../utils/set-id';

/**
 * `agent` authorize `recipient` to join the `object` (Graph, Periodical or Organization)
 */
export default async function handleAuthorizeContributorAction(
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
  const sourceAgent = findRole(action.agent, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });
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
  let recipient = action.recipient;

  // when adding a producer or editor to a Graph the recipient can be specified as a roleId of the Periodical, we reconcile it here
  let periodical;
  if (object['@type'] === 'Graph') {
    const periodicalId = getRootPartId(object);
    if (!periodicalId) {
      throw createError(
        400,
        `Invalid object for ${
          action['@type']
        }, object is not part of a Periodical`
      );
    }

    periodical = await this.get(periodicalId, {
      store,
      acl: false
    });

    const periodicalRole = findRole(recipient, periodical, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (periodicalRole) {
      // we replace recipient by a remaped periodical role if we find one so that recipient can be specifed with an @id in case of a periodical staff want to join a Graph
      recipient = omit(
        remapRole(periodicalRole, 'recipient', { dates: false }),
        ['@id', '_id', '_rev']
      );
    }
  }

  // recipient must be a role
  if (
    !isRole(recipient, 'recipient', {
      needRoleProp: true,
      objectType: object['@type']
    })
  ) {
    throw createError(400, `${action['@type']} recipient must be a valid Role`);
  }

  const recipientId = getId(recipient);
  // if a roleId is specified it must be a UUID
  if (
    recipientId &&
    !(recipientId.startsWith('role:') && reUuid.test(unprefix(recipientId)))
  ) {
    throw createError(
      400,
      `${action['@type']} recipient role cannot have @id unless it's a new UUID`
    );
  }

  const unroledRecipient = unrole(recipient, 'recipient');
  let userId = getId(unroledRecipient);

  if (!userId || !userId.startsWith('user:')) {
    throw createError(
      400,
      `Invalid recipient for ${
        action['@type']
      }. recipient must be a registered sci.pe user`
    );
  }

  // validate profile
  let profile;
  try {
    profile = await this.get(userId, {
      store,
      acl: false
    });
  } catch (err) {
    if (err.code === 404) {
      throw createError(
        400,
        `Invalid agent for ${
          action['@type']
        }. Agent must be a registered sci.pe user`
      );
    }
    throw err;
  }

  // validate roleContactPoint
  let contactPoints;
  if (recipient.roleContactPoint) {
    contactPoints = arrayify(recipient.roleContactPoint)
      .map(contactPoint => {
        return arrayify(profile.contactPoint).find(
          _contactPoint =>
            _contactPoint.contactType === contactPoint.contactType
        );
      })
      .filter(Boolean);
  }

  const handledRecipient = Object.assign(
    { '@type': 'ContributorRole' },
    omit(recipient, ['roleContactPoint']),
    contactPoints && contactPoints.length
      ? { roleContactPoint: contactPoints }
      : undefined,
    {
      recipient: userId
    }
  );

  // when adding a producer or editor to a Graph we make sure that he is listed in the Periodical
  if (
    object['@type'] === 'Graph' &&
    (handledRecipient.roleName === 'editor' ||
      handledRecipient.roleName === 'producer') &&
    !findRole(handledRecipient, periodical, {
      ignoreEndDateOnPublicationOrRejection: true
    })
  ) {
    throw createError(
      400,
      `Invalid recipient for the ${
        action['@type']
      }. Agent (${userId}) must be listed in the Periodical ${
        handledRecipient.roleName
      }s`
    );
  }

  // Check that recipient is not already part of object
  // Note: we allow to add several editor or producer roles as long as they have different subtitle
  const existingRole = findRole(handledRecipient, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (
    existingRole &&
    ((existingRole.name && existingRole.name === handledRecipient.name) ||
      (existingRole.roleName === handledRecipient.roleName &&
        existingRole.roleName !== 'editor' &&
        existingRole.roleName !== 'producer'))
  ) {
    throw createError(
      400,
      `Invalid recipient for the ${
        action['@type']
      }. Recipent (${userId}) is already listed in the ${
        object['@type']
      } (${getId(existingRole)} ${existingRole.name || existingRole.roleName})`
    );
  }

  // Side effect: add handledRecipient to the object
  const savedObject = await this.update(
    object,
    object => {
      const roleProp =
        object['@type'] === 'Organization'
          ? 'member'
          : handledRecipient.roleName;

      // if a role @id was set ahead of time we preserve it.
      // This is required for stories
      let roleId = getId(handledRecipient);

      // we allow to specify a sameAs @id when adding periodical roles to a
      // graph. This is to allow to specify the graph role ahead of time. When
      // we do that we remove the sameAs from the graph role (to ensuire that
      // the roleId is unique to the graph so that we can keep blinding
      // management simple) but set the graph role @id to the sameAs value
      const sameAsId = getId(action.recipient.sameAs);

      if (
        sameAsId &&
        (sameAsId.startsWith('role:') || sameAsId.startsWith('_:')) &&
        reUuid.test(unprefix(sameAsId))
      ) {
        roleId = sameAsId;
      }

      return Object.assign({}, object, {
        [roleProp]: arrayify(object[roleProp]).concat(
          findRole(handledRecipient, object, {
            strict: true,
            ignoreEndDateOnPublicationOrRejection: true
          })
            ? [] // for whatever reason the role was already added => noop
            : setId(
                Object.assign(
                  {},
                  remapRole(handledRecipient, roleProp, { dates: false }),
                  {
                    startDate: new Date().toISOString()
                  }
                ),
                createId(
                  'role',
                  roleId &&
                    roleId.startsWith('role:') &&
                    reUuid.test(unprefix(roleId))
                    ? roleId
                    : null
                )
              )
        )
      });
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
