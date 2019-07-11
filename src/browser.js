import request from 'xhr';
import xhrFactory from './xhr';

export const xhr = xhrFactory(request);
export * from './utils/pouch';
export * from './utils/lucene';
export * from './utils/mime-utils';
export { default as getScopeId } from './utils/get-scope-id';
export { default as handleParticipants } from './utils/handle-participants';
export {
  default as handleUserReferences
} from './utils/handle-user-references';
export { default as getActiveRoleNames } from './utils/get-active-role-names';
export { default as getVisibleRoleNames } from './utils/get-visible-role-names';
export { default as createStyleGuide } from './utils/create-style-guide';
export {
  getWorkflowMap,
  getStageId,
  getTemplateId
} from './utils/workflow-actions';
export { default as setId } from './utils/set-id';
export { default as getPurl } from './utils/get-purl';
export { default as remapRole } from './utils/remap-role';
export { default as flagDeleted } from './utils/flag-deleted';
export { default as schema } from './utils/schema';
export { default as getActiveRoles } from './utils/get-active-roles';
export { default as createId } from './create-id';
export { default as isArchive } from './utils/is-archive';
export {
  default as createAuthorGuidelines
} from './utils/create-author-guidelines';

export * from './utils/permissions';
export * from './utils/contact-point-utils';
export * from './utils/role-utils';
export * from './utils/service-utils';

export { default as findRole } from './utils/find-role';
export { default as getBlindingData } from './utils/get-blinding-data';

export {
  Acl,
  hasPublicAudience,
  hasPermission,
  needActionAssignment,
  isActionAssigned,
  checkAudience,
  hasRole,
  getGranteeId,
  getActionPotentialAssignee,
  getActionPotentialAssigners
} from './acl';

export * from './utils/workflow-utils';
export * from './utils/schema-utils';

export * from './constants';

// social
export { default as escJSON } from './utils/esc-json';
export { default as helmetify } from './social/helmetify';
export * from './social/share';
