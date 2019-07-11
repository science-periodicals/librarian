import { getId, arrayify, unprefix } from '@scipe/jsonld';
import { getAgentId } from './schema-utils';
import getVisibleRoleNames from './get-visible-role-names';
import findRole from './find-role';
import { getSourceRoleId, parseRoleIds } from './role-utils';

/**
 * This is mostly for the font-end to generate nice display names for the anon users
 * - gives number identifier (nice and short) for graph.author, graph.editor, graph.reviewer and graph.producer (cached)
 * - gives first 7 characters of the roleId for graph main entity authors and contribs (computed on the fly)
 */
export default function getBlindingData(
  viewer, // `viewer` is a user, role or audience e.g {'@type': 'Audience', 'audienceType': 'public'}
  graph = {}, // a blinded graph (must be latest one (live graph))
  {
    now,
    inviteActions, // To compute the the `allVisible` prop we need to take into account the recipient active invite action as they are not added to the graph untill the invite is accepted
    ignoreEndDateOnPublicationOrRejection = true
  } = {}
) {
  viewer = findRole(viewer, graph, { now, active: false }) || viewer;

  // Note: we shouldn't return `blindingData` but it's a (bad) legacy API
  const blindingData = {};

  const graphRoles = arrayify(graph.author)
    .concat(
      arrayify(graph.editor),
      arrayify(graph.reviewer),
      arrayify(graph.producer)
    )
    .filter(role => role.roleName);

  // Sort so that we have deterministic index for Reviewer 1, Reviewer 2 etc.
  // We count by `roleName` and userId
  const rolesByRoleNameAndUserId = graphRoles.reduce(
    (rolesByRoleNameAndUserId, role) => {
      if (!(role.roleName in rolesByRoleNameAndUserId)) {
        rolesByRoleNameAndUserId[role.roleName] = {};
      }

      const roleId = getId(role);
      const userId = getAgentId(role); // !! we do not user parseRoleId as userId can be anon:

      if (
        userId &&
        userId !== roleId &&
        (userId.startsWith('user:') || userId.startsWith('anon:'))
      ) {
        if (!(userId in rolesByRoleNameAndUserId)) {
          rolesByRoleNameAndUserId[role.roleName][userId] = [];
        }

        rolesByRoleNameAndUserId[role.roleName][userId].push(role);
      }
      return rolesByRoleNameAndUserId;
    },
    {}
  );

  Object.keys(rolesByRoleNameAndUserId).forEach(roleName => {
    // sort userId by the earliest date of their role
    const rolesByUserId = rolesByRoleNameAndUserId[roleName];
    const sortedUserIds = Object.keys(rolesByUserId).sort((a, b) => {
      const rolesA = rolesByUserId[a];
      const rolesB = rolesByUserId[b];

      const startDatesA = rolesA
        .filter(role => role.startDate)
        .map(role => new Date(role.startDate).getTime());
      const startDatesB = rolesB
        .filter(role => role.startDate)
        .map(role => new Date(role.startDate).getTime());

      if (startDatesA.length && startDatesB.length) {
        return (
          Math.min.apply(Math, startDatesA) - Math.min.apply(Math, startDatesB)
        );
      }

      return 0;
    });

    sortedUserIds.forEach((userId, i) => {
      blindingData[`${roleName}-${userId}`] = (i + 1).toString();

      const roles = rolesByRoleNameAndUserId[roleName][userId];
      roles.forEach(role => {
        if (getId(role)) {
          blindingData[getId(role)] = (i + 1).toString();
        }
      });
    });
  });

  // add a non enumerable getter for convenience
  // Note this return undefined for invite recipient with only an email (no role yet)
  Object.defineProperty(blindingData, 'getAnonymousIdentifier', {
    enumerable: false,
    value: function(
      role, // can also be a roleId or userId
      {
        maxCharacters = 6,
        roleName /* fallback for when role is a string (role: or user:)*/
      } = {}
    ) {
      const roleId = getId(role);
      if (roleId && roleId in blindingData) {
        return blindingData[roleId];
      }

      const sourceRoleId = getSourceRoleId(role);
      if (sourceRoleId && sourceRoleId in blindingData) {
        return blindingData[sourceRoleId];
      }

      roleName = role.roleName || roleName;
      if (roleName) {
        const userId = getAgentId(role);
        if (userId) {
          const key = `${roleName}-${userId}`;
          if (key in blindingData) {
            return blindingData[key];
          }
        }
      }

      if (roleId) {
        const id = unprefix(roleId);
        return maxCharacters != null
          ? id.substring(0, Math.min(maxCharacters, id.length))
          : id;
      }
    }
  });

  const visibleRoleNamesSet = getVisibleRoleNames(viewer, graph, {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection
  });

  const allVisible =
    visibleRoleNamesSet.has('author') &&
    visibleRoleNamesSet.has('editor') &&
    visibleRoleNamesSet.has('reviewer') &&
    visibleRoleNamesSet.has('producer');

  Object.defineProperty(blindingData, 'isBlinded', {
    enumerable: false,
    value: function(role = {}, { roleName = 'user' } = {}) {
      role = findRole(role, graph, { now, active: false }) || role;
      const { userId } = parseRoleIds(role);
      if (userId && userId === getAgentId(viewer)) {
        // if it's the user we never blind.
        return false;
      }
      return !visibleRoleNamesSet.has(role.roleName || roleName);
    }
  });

  Object.defineProperty(blindingData, 'allVisible', {
    enumerable: false,
    value: allVisible
  });

  Object.defineProperty(blindingData, 'visibleRoleNames', {
    enumerable: false,
    value: visibleRoleNamesSet
  });

  // this is used for `getDisplayName` and `getUserBadgeLabel` util in UI, mostly for backward compatibility
  Object.defineProperty(blindingData, 'resolve', {
    enumerable: false,
    value: function(role) {
      const roleId = getSourceRoleId(role);
      if (roleId) {
        const resolved = graphRoles.find(role => getId(role) === roleId);
        if (resolved) {
          return resolved;
        }
      }

      const resolved = findRole(role, graph, { now, active: false });
      if (resolved) {
        return resolved;
      }
      return role;
    }
  });

  return blindingData;
}
