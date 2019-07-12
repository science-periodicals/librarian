import request from 'request';
import xhrFactory from './xhr';

export const xhr = xhrFactory(request);
export { default as Librarian } from './high';
export { default as createId } from './create-id';
export { default as getJournalHostname } from './get-journal-hostname';
export { default as getScopeId } from './utils/get-scope-id';
export { default as getBlindingData } from './utils/get-blinding-data';
export { default as handleParticipants } from './utils/handle-participants';
export {
  default as handleUserReferences
} from './utils/handle-user-references';
export { default as createStyleGuide } from './utils/create-style-guide';
export { default as getActiveRoleNames } from './utils/get-active-role-names';
export { default as getVisibleRoleNames } from './utils/get-visible-role-names';
export { default as schema } from './utils/schema';
export {
  getWorkflowMap,
  getStageId,
  validateAndSetupWorkflowSpecification
} from './utils/workflow-actions';
export {
  default as getResourceBlacklist
} from './utils/get-resource-blacklist';
export { default as getPurl } from './utils/get-purl';
export { default as findRole } from './utils/find-role';
export { default as remapRole } from './utils/remap-role';
export { default as flagDeleted } from './utils/flag-deleted';
export { default as getActiveRoles } from './utils/get-active-roles';

export * from './utils/permissions';
export * from './crypto/encrypt';

export { default as createPassword } from './utils/create-password';
export { default as isArchive } from './utils/is-archive';
export {
  default as createAuthorGuidelines
} from './utils/create-author-guidelines';

export { default as setId } from './utils/set-id';
export { default as Store } from './utils/store';

export * from './utils/service-utils';
export * from './utils/role-utils';
export * from './utils/mime-utils';
export * from './acl';
export * from './low';
export * from './validators';
export * from './queries';
export * from './utils/pouch';
export * from './utils/lucene';
export * from './utils/contact-point-utils';

export * from './utils/workflow-utils';
export * from './utils/schema-utils';

export * from './constants';

// social
export { default as escJSON } from './utils/esc-json';
export { default as helmetify } from './social/helmetify';
export * from './social/share';
