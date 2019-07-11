import { arrayify, getId, unrole } from '@scipe/jsonld';
import createId from '../create-id';
import setId from './set-id';
import { getAgent, getAgentId } from './schema-utils';
import { checkIfRoleIsActive, getSourceRoleId } from './role-utils';

// TODO?
// - we could add "stager" role first time the actionStatus is `StagedActionStatus`
// - we could add "canceler" role first time the actionStatus is `CanceledActionStatus`
// => the agent will be the agent of the final action (completed or failed)

/**
 * - Set @id to audience listed in participant (and upgrade them to Role)
 * - Add `participant` role to `action.participant` for CouchDB permission purpose
 * - Take care of removing the userId for _active_ workflow actions
 *
 * Note: `object` (Graph, Periodical, Organization) should have the new contributors (in case of an
 * invite action for instance)
 *
 * Returns: the input `action` (if no changes were made) or a new `action`
 * (if changes were made)
 */
export default function handleParticipants(action, object, now) {
  if (!object || !action) return action;

  now = now
    ? now instanceof Date
      ? now.toISOString()
      : now
    : new Date().toISOString();

  // Upgrade Audience to Roles + set @id
  let participants = arrayify(action.participant).map(participant => {
    const unroled = unrole(participant, 'participant');
    if (unroled && unroled.audienceType) {
      const audience = setId(
        Object.assign({ '@type': 'Audience' }, unroled),
        createId('audience', unroled.audienceType, getId(object), unroled.name)
      );

      if (participant === unroled) {
        // upgrade to role
        return setId(
          {
            '@type': 'AudienceRole',
            roleName: 'audience',
            participant: audience,
            startDate: now
          },
          createId('arole')
        );
      } else {
        return setId(
          Object.assign(
            { '@type': 'AudienceRole', startDate: now, roleName: 'audience' },
            participant,
            {
              participant: audience
            }
          ),
          createId('arole', participant)
        );
      }
    }

    return participant;
  });

  const roles = arrayify(object.creator).concat(
    arrayify(object.editor),
    arrayify(object.author),
    arrayify(object.reviewer),
    arrayify(object.contributor),
    arrayify(object.producer),
    arrayify(object.member) // for organizations
  );

  const activeAudiences = participants
    .concat(arrayify(action.recipient)) // for CommentAction and InformAction audiences may be defined as recipients
    .filter(participant => {
      const agent = getAgent(participant);
      return (
        agent &&
        agent.audienceType &&
        ((!participant.startDate || participant.startDate <= now) &&
          (!participant.endDate || participant.endDate > now))
      );
    });

  const activeAudienceTypeSet = new Set(
    activeAudiences.map(audience => getAgent(audience).audienceType)
  );

  // Terminate existing participants if audience expired
  participants = participants.map(participant => {
    if (participant.roleName === 'participant' && getId(participant)) {
      // find the original roleName and contrast it with the activeAudienceTypeSet and terminate it
      const roleId = getSourceRoleId(participant);
      const role = roles.find(role => getId(role) === roleId);
      if (role && role.roleName) {
        // not present in active audience => expired
        if (!activeAudienceTypeSet.has(role.roleName)) {
          // if not already expired we expire the role
          if (
            (!participant.startDate || participant.startDate <= now) &&
            (!participant.endDate || participant.endDate > now)
          ) {
            return Object.assign({}, participant, { endDate: now });
          }
        }
      }
    }

    return participant;
  });

  const participantsAndRecipients = participants.concat(
    arrayify(action.recipient)
  );

  // New participants are always added to `participant` never to `audience`
  const newParticipants = [];
  // add new participants from active audience
  activeAudiences.forEach(audienceRole => {
    const audience = getAgent(audienceRole);
    // find matching roles
    const matchingRoles = roles.filter(
      role =>
        getId(role) && // make sure there is an @id otherwise createId('srole') will throw
        role.roleName === audience.audienceType &&
        checkIfRoleIsActive(role, { now })
    );

    matchingRoles.forEach(role => {
      if (
        !participantsAndRecipients.some(participant => {
          return (
            participant.roleName === 'participant' &&
            getId(participant) &&
            getSourceRoleId(participant) === getId(role) &&
            (!participant.endDate ||
              participant.endDate > (audienceRole.endDate || now))
          );
        })
      ) {
        newParticipants.push(
          Object.assign(createId('srole', null, getId(role)), {
            '@type': 'ContributorRole',
            roleName: 'participant',
            startDate: now,
            participant: getAgentId(role)
          })
        );
      }
    });
  });

  const overwrite = {};
  if (participants.length || newParticipants.length) {
    overwrite.participant = participants.concat(newParticipants);
  }

  if (Object.keys(overwrite).length) {
    action = Object.assign({}, action, overwrite);
  }

  return action;
}
