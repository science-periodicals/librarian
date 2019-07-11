import { arrayify, getId } from '@scipe/jsonld';
import { getAgentId } from './schema-utils';
import {
  parseRoleIds,
  getGraphMainEntityContributorRoles,
  checkIfRoleIsActive
} from './role-utils';

export default function findRole(
  role, // !!can be a user
  scope = {},
  {
    now,
    ignoreMainEntity = false,
    active = true,
    strict = false, // if strict is `true` we only match by roleId
    ignoreEndDateOnPublicationOrRejection = false // rejecting or publishing a Graph triggers the end of all roles. We sometimes want to ignore that and treat roles terminated exactly at `datePublished` or `dateRejected` as still active
  } = {}
) {
  now = now || new Date().toISOString();

  let candidateRoles = arrayify(scope.editor)
    .concat(
      arrayify(scope.member), // for organization
      arrayify(scope.reviewer),
      arrayify(scope.author),
      arrayify(scope.contributor),
      arrayify(scope.producer)
    )
    .filter(candidateRole => candidateRole.roleName && getId(candidateRole));

  // add author and contributor listed in the main entity (and parts)
  if (!ignoreMainEntity && scope['@type'] === 'Graph' && scope['@graph']) {
    const extraRoles = getGraphMainEntityContributorRoles(scope);
    candidateRoles.push(...extraRoles);
  }

  if (active) {
    candidateRoles = candidateRoles.filter(candidateRole => {
      return checkIfRoleIsActive(candidateRole, {
        now,
        ignoreEndDateOnPublicationOrRejection,
        scope
      });
    });
  }

  const { roleId, userId } = parseRoleIds(role);

  return candidateRoles.find(candidateRole => {
    return (
      (roleId && roleId === getId(candidateRole)) ||
      (!strict &&
        !roleId &&
        userId &&
        userId === getAgentId(candidateRole) &&
        role &&
        // There must be no ambiguity => we ensure that there is a match with `canditateRole` (it will be a partial match as `role` is missing an @id) AND that there is no ambiguity (only 1 possible partial match for all the `canditateRoles`)
        // `userId`, `roleName` and `name` are known and match with `candidateRole`
        ((role.roleName &&
          role.name &&
          candidateRole.roleName === role.roleName &&
          candidateRole.name === role.name &&
          candidateRoles.filter(
            candidateRole =>
              candidateRole.roleName === role.roleName &&
              candidateRole.name === role.name &&
              getAgentId(candidateRole) === userId
          ).length === 1) ||
          // Only `userId` and `roleName` are known and match with `candidateRole`
          (role.roleName &&
            !role.name &&
            candidateRole.roleName === role.roleName &&
            candidateRoles.filter(
              candidateRole =>
                candidateRole.roleName === role.roleName &&
                getAgentId(candidateRole) === userId
            ).length === 1) ||
          // Only `userId` is known and match with `candidateRole`
          (!role.roleName &&
            !role.name &&
            candidateRoles.filter(
              candidateRole => getAgentId(candidateRole) === userId
            ).length === 1)))
    );
  });
}
