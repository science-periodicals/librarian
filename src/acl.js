import { arrayify, getId, unprefix } from '@scipe/jsonld';
import { getAgent, getAgentId, getObjectId } from './utils/schema-utils';
import getScopeId from './utils/get-scope-id';
import findRole from './utils/find-role';
import schema from './utils/schema';
import getBlindingData from './utils/get-blinding-data';
import getActiveRoles from './utils/get-active-roles';
import getActiveRoleNames from './utils/get-active-role-names';
import {
  ACTION_PERMISSION_TYPES,
  EXPERIMENTAL_GRAPH_PERMISSIONS
} from './constants';
import {
  getSourceRoleId,
  parseRoleIds,
  getGraphMainEntityContributorRoles
} from './utils/role-utils';

// TODO Acl should be the only thing exposed in index.js and browser.js
export class Acl {
  constructor(scope, inviteActions) {
    // scope is a Graph or Periodical
    this.scope = scope;
    this.pendingInviteActions = arrayify(inviteActions).filter(
      action =>
        action['@type'] === 'InviteAction' &&
        (action.actionStatus === 'PotentialActionStatus' ||
          action.actionStatus === 'ActiveActionStatus') &&
        getScopeId(getObjectId(action)) === getScopeId(scope)
    );
  }

  /**
   * Return the scope
   */
  getScope() {
    return this.scope;
  }

  getPendingInviteActions() {
    return this.pendingInviteActions;
  }

  /**
   * Get blinding / annonimization data for the user `user`
   * The returned object has:
   * - `getAnonymousIdentifier(role, {roleName})`
   * - `isBlinded(role, {roleName})`
   * - `visibleRoleNames` Set
   * -  `allVisible` Boolean
   */
  getBlindingData(user, { now, ignoreEndDateOnPublicationOrRejection } = {}) {
    const userId = getAgentId(user);
    return getBlindingData(userId, this.scope, {
      now,
      ignoreEndDateOnPublicationOrRejection,
      inviteActions: this.pendingInviteActions
    });
  }

  /**
   * Get roleName data (containing sub-title) for the user `user`
   * The returned object has a `has(roleName, subRoleName)` method
   */
  getRoleNameData(
    user,
    {
      now,
      ignoreEndDateOnPublicationOrRejection,
      includeMainEntityAuthors = true
    } = {}
  ) {
    return getActiveRoleNames(user, this.scope, {
      inviteActions: this.pendingInviteActions,
      now,
      ignoreEndDateOnPublicationOrRejection,
      includeMainEntityAuthors
    });
  }

  /**
   * return the roles of `user` (can be a role)
   */
  getActiveRoles(user, { now, ignoreEndDateOnPublicationOrRejection } = {}) {
    const { userId } = parseRoleIds(user);
    const roleId = getSourceRoleId(user);

    const roles = getActiveRoles(this.scope, {
      now,
      ignoreEndDateOnPublicationOrRejection
    });
    return roles.filter(
      role =>
        (userId && userId === getAgentId(role)) ||
        (roleId && roleId === getId(role))
    );
  }

  /**
   * Find the full role `role` in the scope
   */
  findRole(role, { now, active = true } = {}) {
    return findRole(role, this.scope, { now, active });
  }

  /**
   * Check if the `role` is audience of `action`
   */
  checkAudience(role, action = {}, { now } = {}) {
    return checkAudience(role, action, { now, scope: this.scope });
  }

  /**
   * Check if the `role` has permission on the scope or `opts.action` (if provided)
   */
  checkPermission(
    role,
    permissionType,
    { permissionScope, action, workflowActions, now, debug = false } = {}
  ) {
    return hasPermission(
      this.scope,
      role,
      action || permissionType,
      action ? permissionType : permissionScope,
      {
        debug,
        now,
        workflowActions,
        inviteActions: this.pendingInviteActions
      }
    );
  }
}

export function parseAuthorization(req) {
  const auth =
    typeof req === 'string'
      ? req
      : req && req.headers && req.headers['authorization'];
  let username, password;
  try {
    [username, password] = Buffer.from(auth.split(' ')[1], 'base64')
      .toString()
      .split(':', 2);
  } catch (e) {}
  return { username, password };
}

export function parseUsername(req) {
  const auth = req.headers && req.headers['authorization'];
  let username;
  if (auth) {
    // the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ=="
    try {
      username = parseAuthorization(req).username;
    } catch (e) {}
    if (username) {
      return username;
    }
  }
  return req.session && req.session.username;
}

export function validateRequiredPermissions(value) {
  if (
    !(
      typeof value === 'string' ||
      typeof value === 'undefined' ||
      (typeof value === 'object' && !Array.isArray(value)) ||
      // [ scopeId ]
      (Array.isArray(value) &&
        value.length === 1 &&
        (typeof value[0] === 'string' ||
          typeof value[0]['@id'] === 'string')) ||
      // [ scopeId, permissionType ]
      (Array.isArray(value) &&
        value.length === 2 &&
        (typeof value[0] === 'string' ||
          (value[0] && typeof value[0]['@id'] === 'string')) &&
        (typeof value[1] === 'string' &&
          /^CreateGraphPermission$|^ReadPermission$|^WritePermission$|^AdminPermission$/.test(
            value[1]
          ))) ||
      // [ scopeId, permissionType or Action, permissionScope or ActionPermission ]
      // `permissionScope` can be a roleName or an audience object or a list thereof
      (Array.isArray(value) &&
        value.length === 3 &&
        // scopeId validation
        (typeof value[0] === 'string' ||
          (value[0] && typeof value[0]['@id'] === 'string')) &&
        // PermissionType and PermissionScope case
        ((typeof value[1] === 'string' &&
          (/^ViewIdentityPermission$|^InvitePermission$/.test(value[1]) &&
            arrayify(value[2]).every(value => {
              // value can be a string, a role or an audience
              if (!value) return false;
              const agent = getAgent(value);
              const id =
                value.audienceType ||
                value.roleName ||
                (agent && agent.roleName) ||
                (agent && agent.audienceType) ||
                value;
              return (
                typeof id === 'string' &&
                /^user$|^editor$|^author$|^reviewer$|^producer$|^public$|^user$/.test(
                  id
                )
              );
            }))) ||
          // Action case
          (schema.is(value[1], 'Action') &&
            typeof value[2] === 'string' &&
            ACTION_PERMISSION_TYPES.has(value[2]))))
    )
  ) {
    throw new Error('invalid permission');
  }
}

export function createCheckAcl(
  user,
  roles = [],
  scopes = [],
  activeInviteActions = []
) {
  const scopeMap = scopes.reduce((scopeMap, scope) => {
    scopeMap[getScopeId(scope)] = scope;
    return scopeMap;
  }, {});

  // TODO define `opts` by desctructuring it here
  return function check(value, opts = {}) {
    if (typeof opts === 'number') {
      opts = {};
    }

    // validate value
    try {
      validateRequiredPermissions(value);
    } catch (e) {
      console.error(e);
      return false;
    }

    if (typeof value === 'string' && value.startsWith('acl:')) {
      // check for CouchDB roles
      return roles.includes(unprefix(value));
    } else if (
      (typeof value === 'string' &&
        (value.startsWith('user:') ||
          value.startsWith('role:') ||
          value.startsWith('srole:') ||
          value.startsWith('mailto:'))) ||
      typeof value === 'undefined' ||
      !Array.isArray(value)
    ) {
      // check for identity
      return roleMatch(
        user,
        value,
        Object.assign(
          {
            scopes,
            inviteActions: activeInviteActions,
            requiresMatchingIdentity: true,
            ignoreEndDateOnPublicationOrRejection: true,
            includeMainEntityAuthors: true // this is needed for the CheckAction for instance where contribs needs access
          },
          opts
        )
      );
    } else {
      // check for permissions
      const [
        objectId,
        permissionType, // can be an action
        permissionScope // can be an action permission if permissionType is an action or a role with roleName or audience object or a list thereof otherwise
      ] = value;

      const scopeId = getScopeId(objectId);

      return hasPermission(
        scopeMap[scopeId],
        user,
        permissionType, // can be an action
        permissionScope, // can be an actionPermission
        Object.assign(
          {
            inviteActions: arrayify(activeInviteActions).filter(
              inviteAction => getScopeId(getObjectId(inviteAction)) === scopeId
            )
          },
          opts
        )
      );
    }
  };
}

export function checkAudience(
  role,
  action,
  {
    now,
    scope,
    inviteActions,
    inviteAction // legacy
  } = {}
) {
  if (!role || !action) return false;

  inviteActions = arrayify(inviteActions || inviteAction);

  if (scope) {
    role = findRole(role, scope) || role;
  }

  return arrayify(action.participant)
    .concat(arrayify(action.recipient))
    .some(
      participant =>
        participant.roleName !== 'assigner' &&
        participant.roleName !== 'unassigner' &&
        roleMatch(role, participant, {
          scopeId: getId(scope),
          scope,
          now,
          inviteActions
        })
    );
}

function getHydratedSourceRole(
  role,
  scopes = [],
  { active = false, now } = {}
) {
  scopes = arrayify(scopes);

  let roleId = getId(role);
  if (roleId) {
    roleId = getSourceRoleId(roleId);
    if (roleId && roleId.startsWith('role:')) {
      // replace role by original role (if only a roleId was passed)
      for (let scope of scopes) {
        const hydratedRole = findRole(roleId, scope, { active, now });
        if (hydratedRole) {
          return hydratedRole;
        }
      }
    }
  }

  return role;
}

/**
 * Check if `source` match `target`
 *
 * if `target` is an audience or an agent definition without
 * identity e.g { roleName: 'editor' }, a scope must be provided
 * through `scopeId` so that the match is evaluated in the
 * context of `scopeId`
 * Unless `requiresMatchingIdentity` is set to `true`, `roleId`
 * and `userId` (or email) will be ignored from the comparision. This is
 * useful as this function is mostly used to see if a `source`
 * is compatible (potentially) with the `target`
 */
export function roleMatch(
  source, // a source for the user (can be a role)
  target, // a userId, roleId, a Person, Organization, Role or an Audience or AudienceRole. In case of Audience and AudienceRole, object (and not ref) must be provided
  {
    requiresMatchingIdentity,
    now,
    scopeId,
    scopes,
    scope, // alias of `scopes`
    inviteActions,
    inviteAction, // alias of `inviteActions`
    ignoreEndDateOnPublicationOrRejection,
    includeMainEntityAuthors = false,
    debug = false
  } = {}
) {
  now = now || new Date().toISOString();
  scopes = arrayify(scopes || scope);
  inviteActions = arrayify(inviteActions || inviteAction);

  // first we replace source and target by their full role if it's a reference
  source = getHydratedSourceRole(source, scopes);
  target = getHydratedSourceRole(target, scopes);

  // Get reliable role and user @id
  let { roleId: sourceRoleId, userId: sourceUserId } = parseRoleIds(source);
  if (!sourceRoleId) {
    const roleId = getSourceRoleId(source);
    if (roleId && roleId.startsWith('role:')) {
      sourceRoleId = roleId;
    }
  }
  const unroledSource = getAgent(source);

  let { roleId: targetRoleId, userId: targetUserId } = parseRoleIds(target);
  if (!targetRoleId) {
    const roleId = getSourceRoleId(target);
    if (roleId && roleId.startsWith('role:')) {
      targetRoleId = roleId;
    }
  }
  const unroledTarget = getAgent(target);

  const hasMatchingIdentity = !!(
    (sourceRoleId && sourceRoleId === targetRoleId) ||
    (sourceUserId && sourceUserId === targetUserId) ||
    (unroledSource &&
      unroledTarget &&
      unroledSource.email &&
      unroledTarget.email &&
      unroledSource.email === unroledTarget.email)
  );

  const targetIsAudience =
    (unroledTarget && unroledTarget.audienceType) ||
    (getId(target) && getId(target).startsWith('arole:')) ||
    (getId(unroledTarget) && getId(unroledTarget).startsWith('audience:'));

  const targetHasUndefinedIdentity =
    !target &&
    !!(
      !targetRoleId &&
      !targetUserId &&
      (!unroledTarget || (unroledTarget && !unroledTarget.email))
    );

  let targetRoleName, targetSubRoleName, targetHasPublicAudience;
  if (targetIsAudience) {
    if (
      (!target.startDate || target.startDate <= now) &&
      (!target.endDate || target.endDate > now)
    ) {
      targetRoleName = unroledTarget && unroledTarget.audienceType;
      targetSubRoleName =
        unroledTarget.audienceType && unroledTarget.name
          ? unroledTarget.name
          : undefined;

      if (
        unroledTarget.audienceType === 'public' ||
        ((sourceRoleId ||
          sourceUserId) /* with audienceType === 'user' we need to guarantee that the user is registered => needs an @id of some sort */ &&
          unroledTarget.audienceType === 'user')
      ) {
        targetHasPublicAudience = true;
      }
    }
  } else {
    targetRoleName = target && target.roleName;
    targetSubRoleName =
      target &&
      target.roleName &&
      target.name &&
      target['name-input'] &&
      target['name-input'].valueRequired &&
      target['name-input'].readonlyValue
        ? target.name
        : undefined;
  }

  const targetHasUndefinedAudience =
    !target || (!targetRoleName && !targetSubRoleName);

  let hasMatchingAudience;
  // if `scopeId` is provided, in case when `target` has no identity or is an
  // audience e.g target is { roleName: 'editor' } -> we check that source is
  // compatible with it by getting the active roleNames of the source from the
  // scope

  // if roleId are equal that's enough. this is important if source is a userId and target is a role for instance
  let hasMatchingRoleId = !!(sourceRoleId && sourceRoleId === targetRoleId);
  if (scopeId) {
    // target has no id or is an audience, we check if that audience is part of the scope
    const scope = scopes.find(
      scope => getScopeId(scopeId) === getScopeId(scope)
    );

    if (scope) {
      if (targetRoleName) {
        const roleNames = getActiveRoleNames(source, scope, {
          inviteActions: inviteActions.filter(
            inviteAction =>
              getScopeId(getObjectId(inviteAction)) === getScopeId(scope)
          ),
          now,
          ignoreEndDateOnPublicationOrRejection,
          includeMainEntityAuthors
        });

        hasMatchingAudience = roleNames.has(targetRoleName, targetSubRoleName);
      }

      if (
        !hasMatchingRoleId &&
        targetRoleId &&
        (sourceUserId || sourceRoleId)
      ) {
        const sourceRoles = getActiveRoles(scope, {
          now,
          ignoreEndDateOnPublicationOrRejection,
          includeMainEntityAuthors
        }).filter(
          role =>
            (sourceRoleId && getId(role) === sourceRoleId) ||
            (sourceUserId && getAgentId(role) === sourceUserId)
        );

        hasMatchingRoleId = sourceRoles.some(
          role => getId(role) === targetRoleId
        );
      }
    }
  }

  if (debug) {
    console.log({
      source,
      target,
      sourceUserId,
      targetUserId,
      sourceRoleId,
      targetRoleId,
      targetHasUndefinedIdentity,
      targetIsAudience,
      targetHasPublicAudience,
      requiresMatchingIdentity,
      hasMatchingAudience,
      hasMatchingRoleId
    });
  }

  return (
    !source ||
    (!sourceUserId && !sourceRoleId) ||
    (targetHasUndefinedIdentity &&
      !targetIsAudience &&
      !requiresMatchingIdentity) ||
    (targetHasUndefinedIdentity && targetHasUndefinedAudience) ||
    targetHasPublicAudience ||
    (hasMatchingAudience && !requiresMatchingIdentity) ||
    (hasMatchingAudience && hasMatchingIdentity) ||
    (targetHasUndefinedAudience && hasMatchingIdentity) ||
    (!scopeId && hasMatchingIdentity) ||
    (sourceRoleId && sourceRoleId === targetRoleId) ||
    hasMatchingRoleId
  );
}

/**
 * `object` is a Graph, Periodical or Action
 * `nodeMap` is only required if we are in flat world
 */
export function hasPublicAudience(
  object = {},
  { nodeMap, now = new Date().toISOString() } = {}
) {
  if (nodeMap) {
    object = nodeMap[getId(object)] || object;
  }

  // action case
  if (object.participant || object.recipient) {
    return arrayify(object.participant)
      .concat(arrayify(object.recipient))
      .some(role => {
        const audience = getAgent(role);
        return (
          audience &&
          audience.audienceType === 'public' &&
          (!role.startDate || role.startDate <= now) &&
          (!role.endDate || role.endDate > now)
        );
      });
  }

  return arrayify(object.hasDigitalDocumentPermission).some(permission => {
    if (nodeMap) {
      permission = nodeMap[getId(permission)];
    }
    return (
      permission &&
      (!permission.permissionType ||
        permission.permissionType === 'ReadPermission' ||
        permission.permissionType === 'WritePermission' ||
        permission.permissionType === 'AdminPermission') &&
      arrayify(permission.grantee).some(grantee => {
        if (nodeMap) {
          grantee = nodeMap[getId(grantee)];
        }
        return grantee && grantee.audienceType === 'public';
      })
    );
  });
}

/**
 * An action needs assignment if the agent.roleName is not listed as the action audience.
 * in that case the only way to access (and perform the action) is to be the action agent
 */
export function needActionAssignment(action = {}) {
  return !!(
    action.agent &&
    action.agent.roleName &&
    !arrayify(action.participant).some(participant => {
      const audience = getAgent(participant);
      return !!(audience && audience.audienceType === action.agent.roleName);
    })
  );
}

/**
 * An action can be staged => agent is set but that's not an assignment
 */
export function isActionAssigned(action) {
  return (
    getAgentId(action.agent) &&
    arrayify(action.participant).some(
      participant => participant.roleName === 'assigner'
    )
  );
}

export function hasPermission(
  object, // Graph or a Periodical
  agent,
  permissionType, // can be an action
  permissionScopeAudience, // optional or action permission type if `permissionType` is an action
  {
    debug = false,
    now = new Date().toISOString(),
    inviteActions,
    inviteAction, // legacy,
    workflowActions
  } = {}
) {
  if (!object || !agent) return false;

  inviteActions = arrayify(inviteActions || inviteAction);

  const unroled = getAgent(agent);
  const roleId = getId(agent);
  const userId = unroled && getId(unroled);
  const userEmail = unroled && unroled.email;
  const audienceType = unroled && unroled.audienceType;
  if (!roleId && !userId && !userEmail && !audienceType) {
    return false;
  }

  if (!permissionType) {
    return true;
  }

  if (typeof permissionType !== 'string') {
    return hasActionPermission(
      object,
      agent,
      permissionType,
      permissionScopeAudience,
      { debug, now, inviteActions, workflowActions }
    );
  }

  if (permissionScopeAudience === null) {
    permissionScopeAudience = undefined; // allow to arrayify it easily (undefined -> [] but null would -> [null])
  }

  if (object['@type'] === 'Organization') {
    // TODO differentiate, Read, Write, Admin
    return arrayify(object.member).some(member => {
      return (
        (!member.endDate || member.endDate > now) &&
        (!member.startDate || member.startDate <= now) &&
        ((roleId && getId(member) === roleId) ||
          (userId && getAgentId(member) === userId))
      );
    });
  }

  const roleNamesData = getActiveRoleNames(agent, object, {
    inviteActions,
    now,
    ignoreEndDateOnPublicationOrRejection: !!(
      permissionType === 'ReadPermission' ||
      permissionType === 'ViewIdentityPermission' ||
      permissionType === 'AdminPermission'
    ),
    includeMainEntityAuthors: !!(
      object['@type'] === 'Graph' && permissionType === 'ReadPermission'
    )
  });

  const permissions = arrayify(object.hasDigitalDocumentPermission)
    .concat(object['@type'] === 'Graph' ? EXPERIMENTAL_GRAPH_PERMISSIONS : [])
    .filter(permission => permission.permissionType === permissionType);

  if (!permissions.length) {
    return false;
  }

  return permissions.some(permission => {
    const isGrantee = arrayify(permission.grantee).some(grantee => {
      return (
        getId(grantee) === roleId ||
        getId(grantee) === userId ||
        getAgentId(grantee) === roleId ||
        getAgentId(grantee) === userId ||
        roleNamesData.has(grantee.audienceType) ||
        grantee.audienceType === 'public' ||
        grantee.audienceType === 'user' // 'user' => any sci.pe user
      );
    });

    if (!isGrantee) {
      return false;
    }

    return arrayify(permissionScopeAudience).every(permissionScopeAudience => {
      const unroled = getAgent(permissionScopeAudience) || {};
      const permissionScopeAudienceType =
        permissionScopeAudience &&
        (permissionScopeAudience.audienceType ||
          permissionScopeAudience.roleName ||
          unroled.audienceType ||
          unroled.roleName ||
          permissionScopeAudience);

      return arrayify(permission.permissionScope).some(permissionScope => {
        return permissionScope.audienceType === permissionScopeAudienceType;
      });
    });
  });
}

// Right now this is used client side only through Acl or hasPermission
function hasActionPermission(
  scope = {}, // right now scope is a Graph, TODO generalize so it can be a periodical or an organization
  user,
  action = {},
  permissionType = 'PerformActionPermission',
  {
    now = new Date().toISOString(),
    inviteActions,
    inviteAction, // legacy
    workflowActions,
    debug = false
  } = {}
) {
  inviteActions = arrayify(inviteActions || inviteAction);

  if (!ACTION_PERMISSION_TYPES.has(permissionType)) {
    throw new Error('invalid permission type');
  }

  const roleMatchOpts = {
    debug,
    scope,
    scopeId: getId(scope),
    now,
    inviteActions,
    workflowActions,
    ignoreEndDateOnPublicationOrRejection:
      permissionType === 'ViewActionPermission'
  };

  const permOpts = {
    now,
    inviteActions,
    workflowActions
  };

  const isAudience = arrayify(action.participant)
    .concat(arrayify(action.recipient))
    .some(
      role =>
        role.roleName !== 'assigner' &&
        role.roleName !== 'unassigner' &&
        roleMatch(user, role, roleMatchOpts)
    );

  const isQualifiedAgent = roleMatch(
    user,
    action.agent,
    Object.assign({}, roleMatchOpts, {
      includeMainEntityAuthors: action['@type'] === 'CheckAction',
      requiresMatchingIdentity:
        isAudience && !isActionAssigned(action) ? false : true // if not audience agent need to have strict identity example: review action specific to one reviewer
    })
  );

  switch (permissionType) {
    case 'ViewActionPermission': {
      let isContrib;
      if (scope['@type'] === 'Graph') {
        const contribRoles = getGraphMainEntityContributorRoles(scope);
        isContrib = contribRoles.some(role => {
          const role1 = user;
          const role2 = role;

          // true if role1 === role2 by roleId or userId
          const sourceRole1Id = getSourceRoleId(role1);
          const sourceRole2Id = getSourceRoleId(role2);
          const { roleId: role1Id, userId: user1Id } = parseRoleIds(role1);
          const { roleId: role2Id, userId: user2Id } = parseRoleIds(role2);

          return (
            (sourceRole1Id &&
              sourceRole2Id &&
              sourceRole1Id.startsWith('role:') &&
              sourceRole2Id.startsWith('role:') &&
              sourceRole1Id === sourceRole2Id) ||
            (role1Id && role2Id && role1Id === role2Id) ||
            (user1Id && user2Id && user1Id === user2Id)
          );
        });
      }

      // handle invites with a purpose
      const isInvitedForAction = inviteActions.some(
        inviteAction =>
          getId(action) &&
          getId(inviteAction.purpose) === getId(action) &&
          roleMatch(user, inviteAction.recipient, roleMatchOpts)
      );

      //console.log({
      //  isQualifiedAgent,
      //  isAudience,
      //  isContrib,
      //  isInvitedForAction
      //});

      return (
        (isQualifiedAgent || isAudience || isContrib || isInvitedForAction) &&
        (hasPermission(scope, user, 'ReadPermission', null, permOpts) ||
          hasPermission(scope, user, 'WritePermission', null, permOpts) ||
          hasPermission(scope, user, 'AdminPermission', null, permOpts))
      );
    }

    case 'PerformActionPermission':
      return (
        !scope.datePublished &&
        !scope.dateRejected &&
        action.actionStatus !== 'CanceledActionStatus' &&
        action.actionStatus !== 'CompletedActionStatus' &&
        ((hasPermission(scope, user, 'AdminPermission', null, permOpts) ||
          hasPermission(scope, user, 'WritePermission', null, permOpts)) &&
          isQualifiedAgent)
      );

    case 'CancelActionPermission': {
      switch (action['@type']) {
        case 'ReviewAction': {
          const stageId = getId(action.resultOf);

          // Note: this will be further verified server side
          const unCanceledReviewActions = arrayify(workflowActions).filter(
            workflowAction => {
              return (
                workflowAction['@type'] === action['@type'] &&
                workflowAction.actionStatus !== 'CanceledActionStatus' &&
                getId(workflowAction.instanceOf) === getId(action.instanceOf) &&
                getId(workflowAction.resultOf) === stageId
              );
            }
          );

          return (
            !isActionAssigned(action) &&
            unCanceledReviewActions.length > (action.minInstances || 0) &&
            !scope.datePublished &&
            !scope.dateRejected &&
            action.actionStatus !== 'CompletedActionStatus' &&
            hasPermission(scope, user, 'AdminPermission', null, permOpts)
          );
        }

        default:
          return false;
      }
    }

    case 'DeleteActionPermission': {
      switch (action['@type']) {
        case 'TagAction': {
          return (
            roleMatch(user, action.agent, { now }) ||
            hasPermission(scope, user, 'AdminPermission', null, permOpts)
          );
        }

        case 'InviteAction':
          return (
            action.actionStatus === 'PotentialActionStatus' &&
            hasPermission(scope, user, 'AdminPermission', null, permOpts)
          );

        case 'ApplyAction':
          return (
            (action.actionStatus === 'PotentialActionStatus' ||
              action.actionStatus === 'ActiveActionStatus') &&
            (hasPermission(scope, user, 'AdminPermission', null, permOpts) ||
              isQualifiedAgent)
          );

        case 'RequestArticleAction':
          return (
            (action.actionStatus === 'PotentialActionStatus' ||
              action.actionStatus === 'ActiveActionStatus') &&
            (hasPermission(scope, user, 'AdminPermission', null, permOpts) ||
              hasPermission(scope, user, 'WritePermission', null, permOpts) ||
              isQualifiedAgent)
          );

        case 'CommentAction':
          return (
            isQualifiedAgent ||
            hasPermission(scope, user, 'AdminPermission', null, permOpts)
          );

        default:
          return false;
      }
    }

    case 'AssignActionPermission': {
      return (
        action['@type'] !== 'InviteAction' &&
        !scope.datePublished &&
        !scope.dateRejected &&
        action.actionStatus !== 'CompletedActionStatus' &&
        action.actionStatus !== 'CanceledActionStatus' &&
        (hasPermission(scope, user, 'AdminPermission', null, permOpts) ||
          (hasPermission(scope, user, 'WritePermission', null, permOpts) &&
            isQualifiedAgent)) &&
        // invite with a purpose block ability to assign
        !inviteActions.some(inviteAction =>
          arrayify(inviteAction.purpose).some(
            purpose => getId(purpose) && getId(purpose) === getId(action)
          )
        )
      );
    }

    case 'RescheduleActionPermission': {
      return (
        action['@type'] !== 'InviteAction' &&
        !scope.datePublished &&
        !scope.dateRejected &&
        action.actionStatus !== 'CompletedActionStatus' &&
        action.actionStatus !== 'CanceledActionStatus' &&
        hasPermission(scope, user, 'AdminPermission', null, permOpts)
      );
    }

    default:
      return (
        !scope.datePublished &&
        !scope.dateRejected &&
        action.actionStatus !== 'CompletedActionStatus' &&
        (hasPermission(scope, user, 'AdminPermission', null, permOpts) ||
          (hasPermission(scope, user, 'WritePermission', null, permOpts) &&
            isQualifiedAgent))
      );
  }
}

/**
 * Make sure that each permission as only 1 grantee (simplify processing for Authorize and DeauthorizeAction)
 * object is typically a periodical but can be anything with a `hasDigitalDocumentPermission` property
 */
export function normalizePermissions(object) {
  if (!object) return object;
  const permissions = arrayify(object.hasDigitalDocumentPermission);
  if (!permissions.length) {
    return object;
  }

  const untouched = [];
  const normalized = [];
  permissions.forEach(permission => {
    const grantees = arrayify(permission.grantee);
    if (grantees.length > 1) {
      grantees.forEach(grantee => {
        normalized.push(Object.assign({}, permission, { grantee }));
      });
    } else {
      untouched.push(permission);
    }
  });

  if (!normalized.length) {
    return object;
  }

  return Object.assign({}, object, {
    hasDigitalDocumentPermission: untouched.concat(normalized)
  });
}

export function getGranteeId(grantee) {
  if (grantee['@type'] === 'Audience') {
    return grantee.audienceType;
  }
  return getAgentId(grantee);
}

export function isEqualDigitalDocumentPermission(permission, _permission) {
  const grantees = arrayify(permission.grantee);
  const _grantees = arrayify(_permission.grantee);
  const scopes = arrayify(permission.permissionScope);
  const _scopes = arrayify(_permission.permissionScope);

  return (
    permission.permissionType === _permission.permissionType &&
    permission.validFrom === _permission.validFrom &&
    permission.validThrough === _permission.validThrough &&
    grantees.length === _grantees.length &&
    grantees.every(grantee =>
      _grantees.some(
        _grantee => getGranteeId(_grantee) === getGranteeId(grantee)
      )
    ) &&
    scopes.length === _scopes.length &&
    scopes.every(scope =>
      _scopes.some(_scope => getGranteeId(_scope) === getGranteeId(scope))
    )
  );
}

/**
 * `object` is a Graph, Periodical or Action
 */
export function hasRole(object, agent, roleName, subRoleNames, now) {
  if (!object) return false;
  const agentId = getAgentId(agent);
  if (!agentId || !agentId.startsWith('user:')) {
    return false;
  }

  now = now || new Date().toISOString();
  const roles = arrayify(object.creator)
    .concat(
      arrayify(object.editor),
      arrayify(object.author),
      arrayify(object.contributor),
      arrayify(object.producer),
      // Action
      arrayify(object.agent),
      arrayify(object.participant)
    )
    .filter(role => {
      return (
        (!role.startDate || role.startDate <= now) &&
        (!role.endDate || role.endDate > now) &&
        getAgentId(role) === agentId
      );
    });
  if (!roles.length) return false;

  if (!roleName) return true;

  subRoleNames = subRoleNames ? arrayify(subRoleNames) : [];
  return roles.some(
    role =>
      role.roleName === roleName &&
      (!subRoleNames.length || subRoleNames.some(title => title === role.name))
  );
}

export function getActionPotentialAssignee(
  action = {},
  graph = {},
  {
    workflowActions, // other instances
    now = new Date().toISOString()
  } = {}
) {
  const roles = getActiveRoles(graph, { now }).filter(role => getId(role));

  const isAssigned = isActionAssigned(action);

  let potentialAssignee = roles.filter(role => {
    return (
      (!(action.agent && action.agent.roleName) ||
        (role.roleName === action.agent.roleName &&
          (!action.agent.name || role.name === action.agent.name))) &&
      (!isAssigned || (isAssigned && getId(role) !== getId(action.agent)))
    );
  });

  if (
    (action.minInstances != null || action.maxInstances != null) &&
    getId(action.resultOf) &&
    getId(action.instanceOf)
  ) {
    // make sure that assignee are unique
    const assignedActions = arrayify(workflowActions).filter(
      workflowAction =>
        workflowAction['@type'] === action['@type'] &&
        getId(workflowAction.resultOf) === getId(action.resultOf) &&
        getId(workflowAction.instanceOf) === getId(action.instanceOf) &&
        isActionAssigned(workflowAction)
    );

    potentialAssignee = potentialAssignee.filter(
      role =>
        !assignedActions.some(
          assignedAction => getId(assignedAction.agent) === getId(role)
        )
    );
  }

  return potentialAssignee;
}

export function getActionPotentialAssigners(
  action = {},
  graph = {},
  user,
  { now } = {}
) {
  const userId = getAgentId(user);

  // To be an assigner we need to have admin access to the graph
  // TODO or be a qualified agent and have write access to the graph

  const admins = new Set();
  arrayify(graph.hasDigitalDocumentPermission).forEach(
    digitalDocumentPermission => {
      if (digitalDocumentPermission.permissionType === 'AdminPermission') {
        arrayify(digitalDocumentPermission.grantee).forEach(grantee => {
          const granteeId = getGranteeId(grantee); // can be a roleName or a userId
          if (granteeId) {
            admins.add(granteeId);
          }
        });
      }
    }
  );

  const roles = getActiveRoles(graph, { now });

  return roles.filter(
    role =>
      getAgentId(role) === userId &&
      (admins.has(role.roleName) ||
        admins.has(getId(role)) ||
        admins.has(getAgentId(role)))
  );
}
