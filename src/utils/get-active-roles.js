import { arrayify } from '@scipe/jsonld';
import {
  checkIfRoleIsActive,
  getGraphMainEntityContributorRoles
} from '../utils/role-utils';

/**
 * `object` is a Graph, Periodical or Organization
 */
export default function getActiveRoles(
  object = {},
  {
    now = new Date().toISOString(),
    ignoreEndDateOnPublicationOrRejection = false, // rejecting or publishing a Graph triggers the end of all roles. We sometimes want to ignore that and treat roles terminated exactly at `datePublished` or `dateRejected` as still active
    includeMainEntityAuthors = false
  } = {}
) {
  const roles = arrayify(object.creator).concat(
    arrayify(object.author),
    arrayify(object.contributor),
    arrayify(object.reviewer),
    arrayify(object.editor),
    arrayify(object.producer),
    arrayify(object.member)
  );

  if (includeMainEntityAuthors && object['@type'] === 'Graph') {
    roles.push(...getGraphMainEntityContributorRoles(object));
  }

  const myRoles = roles.filter(role => {
    return (
      role &&
      role.roleName &&
      checkIfRoleIsActive(role, {
        now,
        ignoreEndDateOnPublicationOrRejection,
        scope: object
      })
    );
  });

  return myRoles;
}
