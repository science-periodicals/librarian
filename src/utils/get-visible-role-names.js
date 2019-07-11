import { arrayify } from '@scipe/jsonld';
import getActiveRoleNames from './get-active-role-names';
import findRole from '../utils/find-role';

/**
 * returns Set of visible roleName ('editor', 'producer') etc..
 */
export default function getVisibleRoleNames(
  viewer, // `viewer` is a user, role or an audience e.g {'@type': 'Audience', 'audienceType': 'public'}
  graph = {},
  {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection // rejecting or publishing a Graph triggers the end of all roles. We sometimes want to ignore that and treat roles terminated exactly at `datePublished` or `dateRejected` as still active
  } = {}
) {
  viewer = findRole(viewer, graph, { now, active: false }) || viewer;

  const userRoleNames =
    viewer && viewer.audienceType
      ? [viewer.audienceType]
      : Object.keys(
          getActiveRoleNames(viewer, graph, {
            inviteActions,
            now,
            ignoreEndDateOnPublicationOrRejection,
            includeMainEntityAuthors: true
          })
        );

  // We add `public` audience as every user belong to that audience
  if (!userRoleNames.some(roleName => roleName === 'public')) {
    userRoleNames.push('public');
  }

  const viewIdentityPermissions = arrayify(
    graph.hasDigitalDocumentPermission
  ).filter(
    permission => permission.permissionType === 'ViewIdentityPermission'
  );

  const wvifw = viewIdentityPermissions.reduce((wvifw, permission) => {
    arrayify(permission.grantee).forEach(grantee => {
      if (grantee.audienceType) {
        if (!(grantee.audienceType in wvifw)) {
          wvifw[grantee.audienceType] = {};
        }
        arrayify(permission.permissionScope).forEach(scope => {
          if (scope.audienceType) {
            wvifw[grantee.audienceType][scope.audienceType] = true;
          }
        });
      }
    });
    return wvifw;
  }, {});

  const visibleRoleNames = userRoleNames.reduce(
    (visibleRoleNames, userRoleName) => {
      if (userRoleName in wvifw) {
        Object.keys(wvifw[userRoleName]).forEach(audienceType => {
          visibleRoleNames.add(audienceType);
        });
      }
      return visibleRoleNames;
    },
    new Set()
  );

  return visibleRoleNames;
}
