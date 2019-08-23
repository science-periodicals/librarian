import traverse from 'traverse';
import pick from 'lodash/pick';
import pickBy from 'lodash/pickBy';
import createError from '@scipe/create-error';
import {
  arrayify,
  getId,
  getNodeMap,
  dearrayify,
  unprefix,
  reUuid
} from '@scipe/jsonld';
import { getAgentId } from './schema-utils';
import { isRole } from '../validators';
import { CONTRIBUTOR_PROPS, COPIED_ROLE_PROPS } from '../constants';
import createId from '../create-id';
import setId from '../utils/set-id';

// TODO handle strict: no roleId can be specified in strict mode

export default function validateAndSetupCreatedCreativeWorkRoles(
  object, // Graph or Periodical
  {
    now = new Date().toISOString(), // used to set the startDate of the roles
    strict = true, // TODO handle
    agent, // the agent of the CreateAction creating the `object`
    participants = [], // the participants of the CreateAction creating the `object`
    agentProfile = {}, // the User profile of the agent
    participantSource = {} // the CreativeWork (Graph or Periodical) from where the participiant must originate
  } = {}
) {
  participants = arrayify(participants);

  // Validate `agent`
  const agentId = getAgentId(agent);
  if (!agentId || !agentId.startsWith('user:')) {
    throw createError(400, 'invalid agent, missing user @id');
  }

  // Validate `participants`
  // Participants must come from `participantSource`
  const participantSourceRoleMap = getNodeMap(
    arrayify(participantSource.creator)
      .concat(...CONTRIBUTOR_PROPS.map(p => participantSource[p]))
      .filter(role => isRole(role) && getId(role))
  );

  if (
    !participants.every(
      participant =>
        getId(participant) && getId(participant) in participantSourceRoleMap
    )
  ) {
    throw createError(
      400,
      'Invalid participants, participants are not existing roles'
    );
  }

  // validate that any contributor of `object` either comes from `agent` or `participants`
  if (
    !CONTRIBUTOR_PROPS.every(p => {
      const roles = arrayify(object[p]);

      return roles.every(role => {
        const roleId = getId(role);
        const userId = getAgentId(role);

        if (
          roleId &&
          participants.some(participant => getId(participant) === roleId)
        ) {
          const sourceRole = participantSourceRoleMap[roleId];

          // contributor comes for the participants
          // ensure role compatibility
          return (
            sourceRole &&
            sourceRole.roleName === p &&
            (!role.name || role.name === sourceRole.name)
          );
        }

        // contributor must comes from the agent
        // we are somewhat loose in that case, either the roleIds match, or there are no roleId and the userId matches or the roleId is a blank node or or role:<uuid> and the agent was not a role or a role with no @id
        return (
          // in all case userIds must be the agentId
          userId &&
          userId === agentId &&
          ((roleId && roleId === getId(agent)) ||
          (roleId && roleId === agentId) || // agentId is a user @id for sure => can be the case where the role was specified as just a user id
            (!roleId ||
              (roleId &&
                (roleId.startsWith('_:') ||
                  // roleId specified as a role:<uuid> this is useful for stories when we need to know the roleId ahead of time
                  (roleId.startsWith('role:') &&
                    reUuid.test(unprefix(roleId)))) &&
                // the agent is not a role or a role without @id
                (agentId === getId(agent) || !getId(agent)))))
        );
      });
    })
  ) {
    throw createError(
      400,
      `Invalid contributor. Some value listed in one of ${CONTRIBUTOR_PROPS.join(
        ', '
      )} in ${
        object['@type']
      } cannot be related to the action agent or participant`
    );
  }

  // Contributors are valid => we remap them to proper roles and cleanup the contact points when the contributor comes from the agent
  const contactPointMap = arrayify(agentProfile.contactPoint).reduce(
    (map, contactPoint) => {
      if (contactPoint.contactType) {
        map[contactPoint.contactType] = contactPoint;
      }
      return map;
    },
    {}
  );

  const relabelMap = {};
  const overwrite = CONTRIBUTOR_PROPS.filter(p => p in object).reduce(
    (overwrite, p) => {
      overwrite[p] = dearrayify(
        object[p],
        arrayify(object[p]).map(role => {
          const roleId = getId(role);

          // we allow to specify a sameAs @id when adding periodical roles to a
          // graph. This is to allow to specify the graph role ahead of time. When
          // we do that we remove the sameAs from the graph role (to ensuire that
          // the roleId is unique to the graph so that we can keep blinding
          // management simple) but set the graph role @id to the sameAs value
          const sameAsId = getId(role.sameAs);

          if (
            sameAsId &&
            (sameAsId.startsWith('role:') || sameAsId.startsWith('_:')) &&
            reUuid.test(unprefix(sameAsId))
          ) {
            if (roleId) {
              relabelMap[roleId] = sameAsId;
            }
          }

          if (
            roleId &&
            participants.some(participant => getId(participant) === roleId)
          ) {
            // contributor comes from the participants (we have guarantee from the validation that the role are compatible, so we just set new @id
            const sourceRole = participantSourceRoleMap[getId(role)]; // !! do not use roleId as sameAs has been taken into account

            const objectRoleId = sameAsId || roleId;

            return setId(
              Object.assign(
                {
                  '@type': 'ContributorRole'
                },
                pick(sourceRole, COPIED_ROLE_PROPS),
                {
                  [p]: getAgentId(sourceRole),
                  startDate: now
                }
              ),
              createId(
                'role',
                objectRoleId.startsWith('role:') ||
                  (objectRoleId.startsWith('_:') &&
                    reUuid.test(unprefix(objectRoleId)))
                  ? objectRoleId
                  : null
              ),
              relabelMap
            );
          }

          // contributor comes for the agent so we know for sure that the userId is agentId

          const contactPoints = [];
          // only add valid contact points
          arrayify(role.roleContactPoint).forEach(contactPoint => {
            if (
              contactPoint.contactType &&
              contactPoint.contactType in contactPointMap
            ) {
              contactPoints.push(
                pick(contactPointMap[contactPoint.contactType], [
                  '@id',
                  '@type',
                  'contactType'
                ])
              );
            }
          });

          return setId(
            pickBy(
              {
                '@id': roleId !== agentId ? roleId : undefined, // we set the @id so that it get picked by setId and added to the relabelMap
                '@type': 'ContributorRole',
                startDate: now,
                roleName: p,
                name: role.name,
                [p]: agentId,
                roleContactPoint: contactPoints.length
                  ? contactPoints
                  : undefined
              },
              x => x !== undefined
            ),
            createId(
              'role',
              roleId !== agentId &&
                roleId &&
                (roleId.startsWith('role:') ||
                  (roleId.startsWith('_:') && reUuid.test(unprefix(roleId))))
                ? roleId
                : null
            ), // if roleId was set this will change the prefix from _: to role: for instance. Note that we still need to set the @id before that so the _: @id becomes part of the relabelMap
            relabelMap
          );
        })
      );

      return overwrite;
    },
    {}
  );

  return traverse.map(
    Object.assign({ creator: agentId }, object, overwrite),
    function(x) {
      if (typeof x === 'string' && x.startsWith('_:')) {
        if (x in relabelMap) {
          this.update(relabelMap[x]);
        }
      }
    }
  );
}
