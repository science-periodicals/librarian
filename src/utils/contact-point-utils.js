import { unprefix, getId } from '@scipe/jsonld';

export function getContactPointUserId(contactPointId) {
  contactPointId = getId(contactPointId);
  if (!contactPointId) return;

  // see createId
  // contactPointId is: contact:user-username@contactPointType

  const [prefix] = contactPointId.split('@', 2);
  const userDashedId = unprefix(prefix);
  if (userDashedId && userDashedId.startsWith('user-')) {
    return userDashedId.replace(/^user-/, 'user:');
  }
}

export function getContactPointScopeId(contactPointId) {
  contactPointId = getId(contactPointId);
  if (!contactPointId) return;

  // see createId
  // contactPointId is: contact:user-username@contactPointType

  const [prefix] = contactPointId.split('@', 2);
  const userDashedId = unprefix(prefix);
  if (userDashedId && userDashedId.startsWith('user-')) {
    return userDashedId.replace(/^user-/, 'user:');
  }

  if (userDashedId && userDashedId.startsWith('org-')) {
    return userDashedId.replace(/^org-/, 'org:');
  }
}
