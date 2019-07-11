import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId, arrayify, reUuid, unprefix } from '@scipe/jsonld';
import { getObjectId, getRootPartId } from '../utils/schema-utils';
import { isRole } from '../validators';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import setId from '../utils/set-id';
import {
  getGraphMainEntityContributorRoles,
  parseRoleIds
} from '../utils/role-utils';

/**
 * `agent` joins the `object` (Graph, Periodical or Organization)
 */
export default async function handleJoinAction(
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
  let role = action.agent;

  if (object['@type'] === 'Graph') {
    // agent can be the @id of a graph main entity contributor
    const contribRole = getGraphMainEntityContributorRoles(object).find(
      contribRole => getId(contribRole) === getId(role)
    );
    if (contribRole) {
      role = omit(remapRole(contribRole, 'agent', { dates: false }), [
        '@id',
        '_id',
        '_rev'
      ]);
    } else {
      // when adding a producer or editor to a Graph the agent can be specified as a roleId of the Periodical, we reconcile it here
      const periodicalId = getRootPartId(object);
      if (!periodicalId) {
        throw createError(
          400,
          `Invalid object for ${
            action['@type']
          }, object is not part of a Periodical`
        );
      }

      const periodical = await this.get(periodicalId, {
        store,
        acl: false
      });

      const periodicalRole = findRole(role, periodical, {
        ignoreEndDateOnPublicationOrRejection: true
      });

      // when adding a producer or editor to a Graph we make sure that he is listed in the Periodical
      if (
        (role.roleName === 'editor' || role.roleName === 'producer') &&
        !periodicalRole
      ) {
        throw createError(
          400,
          `Invalid agent for the ${
            action['@type']
          }. Agent (${userId}) must be listed in the Periodical ${
            handledAgent.roleName
          }s`
        );
      }

      if (periodicalRole) {
        // we replace agent by a remaped periodical role if we find one so that agent can be specifed with an @id in case of a periodical staff want to join a Graph
        role = omit(remapRole(periodicalRole, 'agent', { dates: false }), [
          '@id',
          '_id',
          '_rev'
        ]);
      }
    }
  }

  // agent must be a role
  if (
    !isRole(role, 'agent', {
      needRoleProp: true,
      objectType: object['@type']
    })
  ) {
    throw createError(400, `${action['@type']} agent must be a valid Role`);
  }

  const { userId } = parseRoleIds(role);

  if (!userId || !userId.startsWith('user:')) {
    throw createError(
      400,
      `Invalid agent for ${
        action['@type']
      }. agent must be a registered sci.pe user`
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
  if (role.roleContactPoint) {
    contactPoints = arrayify(action.agent.roleContactPoint)
      .map(contactPoint => {
        return arrayify(profile.contactPoint).find(
          _contactPoint =>
            _contactPoint.contactType === contactPoint.contactType
        );
      })
      .filter(Boolean);
  }

  let roleId = getId(role);
  if (roleId) {
    throw createError(400, `${action['@type']} agent role cannot have @id`);
  }
  // we allow to specify a sameAs @id when adding periodical roles to a
  // graph. This is to allow to specify the graph role ahead of time. When
  // we do that we remove the sameAs from the graph role (to ensure that
  // the roleId is unique to the graph so that we can keep blinding
  // management simple) but set the graph role @id to the sameAs value
  const sameAsId = getId(action.agent.sameAs);

  if (
    sameAsId &&
    (sameAsId.startsWith('role:') || sameAsId.startsWith('_:')) &&
    reUuid.test(unprefix(sameAsId))
  ) {
    roleId = sameAsId;
  }

  const handledAgent = setId(
    Object.assign(
      { '@type': 'ContributorRole' },
      omit(role, ['roleContactPoint']),
      contactPoints && contactPoints.length
        ? { roleContactPoint: contactPoints }
        : undefined,
      {
        agent: userId
      }
    ),
    createId('role', roleId)
  );

  // Check that agent is not already part of object
  // Note: we allow to add several editor or producer roles as long as they have different subtitle
  const existingRole = findRole(handledAgent, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (
    existingRole &&
    ((existingRole.name && existingRole.name === handledAgent.name) ||
      (existingRole.roleName === handledAgent.roleName &&
        existingRole.roleName !== 'editor' &&
        existingRole.roleName !== 'producer'))
  ) {
    throw createError(
      400,
      `Invalid agent for the ${
        action['@type']
      }. agent (${userId}) is already listed in the ${object['@type']} (${getId(
        existingRole
      )} ${existingRole.name || existingRole.roleName})`
    );
  }

  // Side effect: add handledAgent to the object
  const savedObject = await this.update(
    object,
    object => {
      const roleProp =
        object['@type'] === 'Organization' ? 'member' : handledAgent.roleName;

      return Object.assign({}, object, {
        [roleProp]: arrayify(object[roleProp]).concat(
          findRole(handledAgent, object, {
            strict: true,
            ignoreEndDateOnPublicationOrRejection: true
          })
            ? [] // for whatever reason the role was already added => noop
            : Object.assign(
                {},
                remapRole(handledAgent, roleProp, { dates: false }),
                {
                  startDate: new Date().toISOString()
                }
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
