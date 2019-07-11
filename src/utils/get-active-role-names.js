import flatten from 'lodash/flatten';
import { arrayify } from '@scipe/jsonld';
import { getAgentId } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import {
  checkIfRoleIsActive,
  getGraphMainEntityContributorRoles
} from '../utils/role-utils';

const ROLE_NAMES = new Set([
  'administrator',
  'editor',
  'author',
  'reviewer',
  'producer',
  'user'
]);

// `object` is a Graph, Periodical or Organization
export default function getActiveRoleNames(
  agent,
  object,
  {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection = false, // rejecting or publishing a Graph triggers the end of all roles. We sometimes want to ignore that and treat roles terminated exactly at `datePublished` or `dateRejected` as still active
    includeMainEntityAuthors = false
  } = {}
) {
  agent = findRole(agent, object, { now, active: false }) || agent;
  const agentId = getAgentId(agent);

  inviteActions = inviteActions == null ? [] : arrayify(inviteActions);
  object = object || {};

  now = now || new Date().toISOString();

  const roles = arrayify(object.creator)
    .concat(
      arrayify(object.author),
      arrayify(object.member),
      arrayify(object.reviewer),
      arrayify(object.contributor),
      arrayify(object.editor),
      arrayify(object.producer),
      flatten(
        inviteActions.map(inviteAction => arrayify(inviteAction.recipient))
      ) // we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    )
    .filter(Boolean);

  if (includeMainEntityAuthors && object['@type'] === 'Graph') {
    roles.push(...getGraphMainEntityContributorRoles(object));
  }

  const data = roles
    .filter(role => {
      return (
        getAgentId(role) === agentId &&
        role.roleName &&
        ROLE_NAMES.has(role.roleName) &&
        checkIfRoleIsActive(role, {
          now,
          ignoreEndDateOnPublicationOrRejection,
          scope: object
        })
      );
    })
    .reduce((roleMap, role) => {
      if (!(role.roleName in roleMap)) {
        roleMap[role.roleName] = {};
      }
      if (role.name) {
        roleMap[role.roleName][role.name] = true;
      }
      return roleMap;
    }, {});

  Object.defineProperty(data, 'has', {
    enumerable: false,
    value: function(roleName, subRoleName) {
      const roleNameData = this[roleName];
      if (!roleNameData) return false;
      return subRoleName ? !!roleNameData[subRoleName] : true;
    }
  });

  return data;
}
