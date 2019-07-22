import createError from '@scipe/create-error';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import {
  getObjectId,
  getObject,
  getTargetCollectionId,
  getRootPartId,
  getAgentId
} from '../utils/schema-utils';
import { Acl } from '../acl';
import schema from '../utils/schema';
import getScopeId from '../utils/get-scope-id';
import findRole from '../utils/find-role';
import getActiveRoles from '../utils/get-active-roles';
import { getGraphMainEntityContributorRoles } from '../utils/role-utils';
import { getContactPointScopeId } from '../utils/contact-point-utils';
import { getVersion } from '../utils/workflow-utils';

export default async function checkWriteAcl(action, { store, acl } = {}) {
  if (String(acl) === 'false') {
    return;
  }

  if (!schema.is(action, 'Action')) {
    throw createError(403, 'only action can be sent to POST or PUT');
  }

  try {
    var check = await this.checkAcl({
      acl,
      store,
      docs: action,
      checkActiveInviteActions: false
    });
  } catch (err) {
    if (err.code !== 401) {
      throw err;
    }

    // Handle unregistered user cases:

    // `RegisterAction`, `ResetPasswordAction`, `UpdatePasswordAction` (user is
    // not logged in yet or can't log in)
    if (action['@type'] === 'RegisterAction') {
      return;
    }

    if (action['@type'] === 'ResetPasswordAction') {
      if (
        !getObjectId(action) ||
        getObjectId(action) !== getAgentId(action.agent)
      ) {
        throw createError(
          403,
          `Not allowed to perform ${action['@type'] ||
            'action'} (object and agent @id must be defined and equal)`
        );
      }
      return;
    }

    if (
      action['@type'] === 'UpdatePasswordAction' &&
      action.instrument &&
      action.instrument['@type'] === 'Token'
    ) {
      if (
        !getTargetCollectionId(action) ||
        getTargetCollectionId(action) !== getAgentId(action.agent)
      ) {
        throw createError(
          403,
          `Not allowed to perform ${action['@type'] ||
            'action'} (targetCollection and agent @id must be defined and equal and a resetPasswordToken must exists)`
        );
      }
      return;
    }

    // `InformAction` associated with `RegisterAction` or `ResetPasswordAction`
    if (action['@type'] === 'InformAction') {
      const object = await this.get(getObjectId(action), {
        store,
        acl: false
      });
      if (object['@type'] === 'RegisterAction') {
        const agentEmail = object.agent && object.agent.email;
        if (
          !arrayify(action.recipient).every(
            recipient => recipient.email === agentEmail
          )
        ) {
          throw createError(
            403,
            `Not allowed to perform ${action['@type'] || 'action'}`
          );
        }
        return;
      } else if (object['@type'] === 'ResetPasswordAction') {
        if (
          !arrayify(action.recipient).every(
            recipient => getAgentId(recipient) === getAgentId(object.agent)
          )
        ) {
          throw createError(
            403,
            `Not allowed to perform ${action['@type'] || 'action'}`
          );
        }
        return;
      }
    }

    throw err;
  }

  if (check('acl:readOnlyUser')) {
    throw createError(403, 'not allowed, readOnlyUser cannot write');
  }

  let hasPermission = false;

  // helpers
  const getObjectData = async (action, { fetch = true } = {}) => {
    const objectId = getObjectId(action);
    if (!objectId) {
      throw createError(
        400,
        `invalid action: undefined object @id for ${action['@type']}`
      );
    }

    if (!fetch) {
      return { objectId };
    }

    try {
      var object = await this.get(objectId, {
        store,
        acl: false
      });
    } catch (err) {
      if (err.code === 404) {
        throw createError(
          400,
          `checkWriteAcl: invalid action ${action['@id']} ${
            action['@type']
          }: could not fetch object ${objectId}`
        );
      } else {
        throw err;
      }
    }

    // extra complexity with embedded Role or CssVariable
    const scopeId = getScopeId(object);

    return { scopeId, objectId, object };
  };

  const getTargetCollectionData = async (action, { fetch = true } = {}) => {
    const targetCollectionId = getTargetCollectionId(action);
    if (!targetCollectionId) {
      throw createError(400, 'invalid action: undefined targetCollection @id');
    }

    if (!fetch) {
      return { targetCollectionId };
    }

    let targetCollection, scopeId;
    if (targetCollectionId.startsWith('stripe:')) {
      targetCollection = await this.getStripeObject(targetCollectionId);
      scopeId = getId(
        targetCollection &&
          targetCollection.metadata &&
          targetCollection.metadata.organization
      );
    } else {
      try {
        targetCollection = await this.get(targetCollectionId, {
          store,
          acl: false
        });
      } catch (err) {
        if (err.code === 404) {
          throw createError(
            400,
            'invalid action: could not fetch targetCollection'
          );
        } else {
          throw err;
        }
      }

      // extra complexity with embedded Role or CssVariable
      scopeId = getScopeId(targetCollection);
    }

    return { scopeId, targetCollectionId, targetCollection };
  };

  switch (action['@type']) {
    case 'RegisterAction':
    case 'ResetPasswordAction':
      hasPermission = true;
      break;

    case 'CreateAuthenticationTokenAction':
      hasPermission = check.isAdmin && check(action.agent);
      break;

    case 'UpdatePasswordAction': {
      const { targetCollectionId: userId } = await getTargetCollectionData(
        action,
        { fetch: false }
      );

      hasPermission = check.isAdmin || check(userId);
      break;
    }

    case 'CreateOrganizationAction':
      hasPermission = check.isAdmin || check(action.agent);
      break;

    case 'SubscribeAction': {
      const scopeId = getId(action.instrument); // organizationId
      if (!scopeId) {
        throw createError(
          400,
          `Invalid ${
            action['@type']
          }: invalid instrument (must be an organization @id)`
        );
      }
      hasPermission =
        check(action.agent) && check([scopeId, 'AdminPermission']);
      break;
    }

    case 'CreateCustomerAccountAction':
    case 'CreatePaymentAccountAction': {
      const { objectId: scopeId } = await getObjectData(action, {
        fetch: false
      });
      hasPermission =
        check(action.agent) && check([scopeId, 'AdminPermission']);
      break;
    }

    case 'CreateOfferAction':
    case 'CreatePublicationTypeAction':
    case 'CreateWorkflowSpecificationAction':
    case 'CreatePeriodicalAction':
    case 'CreateServiceAction': {
      const { objectId: scopeId } = await getObjectData(action, {
        fetch: false
      });
      hasPermission =
        check.isAdmin ||
        (check(action.agent) && check([scopeId, 'AdminPermission']));
      break;
    }

    case 'CreateGraphAction': {
      const { scopeId } = await getObjectData(action);

      hasPermission =
        check.isAdmin ||
        (check(action.agent) && check([scopeId, 'CreateGraphPermission']));
      break;
    }

    case 'TypesettingAction': {
      const { scopeId } = await getObjectData(action);

      // Note: we don't really care of the agent for the
      // TypesettingAction as auth is based on a proxy user
      // (see checkAcl)
      // We just need to ensure that the proxy user has write
      // access to the scope
      hasPermission =
        check.isAdmin ||
        (check([scopeId, 'AdminPermission']) ||
          check([scopeId, 'WritePermission']));
      break;
    }

    case 'DocumentProcessingAction':
    case 'ImageProcessingAction':
    case 'AudioVideoProcessingAction':
    case 'UploadAction': {
      const object = getObject(action); // an encoding (`MediaObject`)

      const contextId =
        getId(object.isNodeOf) ||
        getId(
          object.encodesCreativeWork && object.encodesCreativeWork.isNodeOf
        );

      const scopeId = contextId && getScopeId(contextId); // contextId may be versionned

      // TODO check that `action.agent` is who he claims to be (check(action.agent))

      // first check on direct scope (see below for extra checks for releases, issues and services)
      hasPermission =
        check.isAdmin ||
        (scopeId && scopeId.startsWith('graph:')
          ? check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])
          : scopeId
          ? check([scopeId, 'AdminPermission'])
          : false);

      // for upload / webify targetting a release, the agent may not have access
      // to the Graph but have write access to the journal
      if (
        !hasPermission &&
        contextId &&
        contextId.startsWith('graph:') &&
        getVersion(contextId) != null
      ) {
        const release = await this.get(contextId, { acl: false, store });
        if (release) {
          const journalId = getRootPartId(release);
          if (journalId) {
            hasPermission =
              check([journalId, 'AdminPermission']) ||
              check([journalId, 'WritePermission']);
          }
        }
      }

      // for upload / webify targetting an issue the scope is the journal
      // for upload / webify targetting a service the scope is the org
      if (
        !hasPermission &&
        contextId &&
        (contextId.startsWith('issue:') || contextId.startsWith('service:'))
      ) {
        const childScope = await this.get(contextId, { acl: false, store });
        if (childScope) {
          const scopeId = getScopeId(childScope);
          if (scopeId) {
            hasPermission =
              check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'WritePermission']);
          }
        }
      }

      break;
    }

    case 'TagAction':
    case 'CommentAction': {
      const { scopeId } = await getObjectData(action);
      // TODO for comment do not allow to create comment according to same rules as app-suite
      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          (check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])));
      break;
    }

    case 'EndorseAction':
    case 'CreateReleaseAction':
    case 'DeclareAction':
    case 'ReviewAction':
    case 'PayAction':
    case 'AssessAction': {
      const { scopeId } = await getObjectData(action);

      // Note further checks (agent requirement, requiresCompletionOf) etc.
      // are performed in `ensureWorkflowCompliance`
      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          (check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])));
      break;
    }

    case 'PublishAction': {
      // Publish requires admin or write access to the journal
      const { scopeId, object } = await getObjectData(action);

      const journalId = getRootPartId(object);

      // Note further checks (agent requirement, requiresCompletionOf) etc.
      // are performed in `ensureWorkflowCompliance`
      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          (check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])) &&
          (check([journalId, 'AdminPermission']) ||
            check([journalId, 'WritePermission'])));
      break;
    }

    case 'ReplyAction': {
      // Note further check are done in the ReplyAction handler: we check that the agent is compatible with the specification of the parentAction agent (DeclareAction or ReviewAction)
      // object of a reply action is a question: that is embedded in a ReviewAction or DeclareAction (the `parentAction`)
      const parentAction = await this.getEmbedderByEmbeddedId(
        getObjectId(action),
        { store }
      );
      const { objectId: scopeId } = await getObjectData(parentAction, {
        fetch: false
      });

      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          (check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])));

      break;
    }

    case 'BuyAction': {
      let workflowAction;
      try {
        workflowAction = await this.get(getId(action.instrumentOf), {
          store,
          acl: false
        });
      } catch (err) {
        this.log.error(
          { err, action },
          'checkWriteAcl could not fetch workflowAction'
        );
      }
      hasPermission =
        check.isAdmin ||
        arrayify(action.agent).some(agent =>
          check(agent, { scopeId: getScopeId(workflowAction) })
        );
      break;
    }

    case 'CreatePublicationIssueAction':
    case 'CreateSpecialPublicationIssueAction': {
      const { scopeId } = await getObjectData(action);
      hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      break;
    }

    case 'AssignAction':
    case 'UnassignAction': {
      const { scopeId, object } = await getObjectData(action);
      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          (check([scopeId, 'AdminPermission']) ||
            check([scopeId, object, 'AssignActionPermission'])));
      break;
    }

    case 'ScheduleAction': {
      const { scopeId } = await getObjectData(action);

      // reschedule a workflow action
      hasPermission =
        check.isAdmin ||
        (check(action.agent, { scopeId }) &&
          check([scopeId, 'AdminPermission']));

      break;
    }

    case 'AssignContactPointAction':
    case 'UnassignContactPointAction': {
      // recipient is a Role, object is a ContactPoint
      const recipientId = getId(action.recipient);
      if (!recipientId || !recipientId.startsWith('role:')) {
        throw createError(
          400,
          `Invalid ${action['@type']}: invalid recipient @id`
        );
      }

      const scope = await this.getEmbedderByEmbeddedId(recipientId, { store }); // Graph, Org or Periodical
      hasPermission = check.isAdmin || check([getId(scope), 'AdminPermission']);
      break;
    }

    case 'UpdateContactPointAction': {
      const scope = await this.get(
        getContactPointScopeId(getTargetCollectionId(action)),
        { store, acl: false }
      );
      const scopeId = getId(scope);
      if (!scopeId) {
        throw createError(
          400,
          `Invalid ${action['@type']}: invalid targetCollection @id`
        );
      }

      // the scope is a Person or an Organization
      if (scopeId.startsWith('user:')) {
        hasPermission = check.isAdmin || (check(action.agent) && check(scope));
      } else {
        hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      }
      break;
    }

    case 'AuthorizeAction':
    case 'DeauthorizeAction': {
      const { scopeId } = await getObjectData(action);

      if (scopeId.startsWith('journal:')) {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) && check([scopeId, 'AdminPermission']));
      } else if (scopeId.startsWith('graph:')) {
        hasPermission =
          check.isAdmin ||
          (check(action.agent, { scopeId }) &&
            check([scopeId, 'AdminPermission']));
      } else {
        hasPermission = check.isAdmin;
      }
      break;
    }

    case 'CancelAction':
    case 'ArchiveAction':
    case 'ActivateAction':
    case 'DeactivateAction': {
      const { scopeId } = await getObjectData(action);
      hasPermission =
        check.isAdmin ||
        (check(action.agent) && check([scopeId, 'AdminPermission']));
      break;
    }

    case 'InformAction': {
      const { scopeId, object } = await getObjectData(action);
      // Note: we only check that user is the agent and that
      // recipient have access to the scope _but_ we will check acl
      // again when we hydrate the email so acl will be enforced on
      // the email attachments (if any)

      // Also, handleInform action will validate that email
      // messages recipient are a strict subset of the action
      // recipient to prevent abusing InformActions to spam users (or
      // random email addresses) so it's fine to just check for
      // the action recipient here

      if (object['@type'] === 'UpdateContactPointAction') {
        // for UpdateContactPointAction we need to take into account that
        // recipient may not be in our system (can be just an email, if so
        // it must match the update payload)
        hasPermission =
          check.isAdmin ||
          arrayify(action.recipient).every(recipient => {
            const upd = getObject(object);
            const unroled = unrole(recipient, 'recipient');
            return (
              check(recipient) ||
              (!getId(recipient) &&
                !getId(unroled) &&
                upd &&
                unroled &&
                upd.email === unroled.email)
            );
          });
      } else if (object['@type'] === 'ResetPasswordAction') {
        // Special case: no scope to check
        hasPermission =
          check.isAdmin ||
          arrayify(action.recipient).every(recipient => {
            return check(recipient);
          });
      } else {
        const acl = new Acl(
          store.get(scopeId),
          schema.is(object, 'Action') ? object /* InviteAction */ : undefined // We pass the invite action the the Acl constructor to handle email send for invites (where the recipient don't have access to the scope yet...)
        );

        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            (check([scopeId, 'ReadPermission']) ||
              check([scopeId, 'WritePermission']) ||
              check([scopeId, 'AdminPermission'])) &&
            arrayify(action.recipient).every(recipient => {
              return (
                acl.checkPermission(recipient, 'ReadPermission') ||
                acl.checkPermission(recipient, 'WritePermission') ||
                acl.checkPermission(recipient, 'AdminPermission')
              );
            }));
      }
      break;
    }

    case 'UpdateAction': {
      const {
        scopeId,
        targetCollection,
        targetCollectionId
      } = await getTargetCollectionData(action);

      if (targetCollectionId && targetCollectionId.startsWith('stripe:')) {
        // Update a stripe account (need to be org admin)
        hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      } else if (
        targetCollection &&
        getId(targetCollection) &&
        getId(targetCollection).startsWith('org:')
      ) {
        hasPermission =
          check.isAdmin || check([getId(targetCollection), 'AdminPermission']);
      } else if (
        targetCollection &&
        (targetCollection['@type'] === 'Person' ||
          targetCollection['@type'] === 'Organization')
      ) {
        hasPermission =
          check.isAdmin || (check(action.agent) && check(targetCollection));
      } else if (
        getId(targetCollection) &&
        getId(targetCollection).startsWith('role:')
      ) {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            (check(targetCollection) || check([scopeId, 'AdminPermission'])));
      } else if (
        targetCollection &&
        targetCollection['@type'] === 'PublicationType'
      ) {
        hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      } else if (targetCollection && targetCollection['@type'] === 'Service') {
        // scope is an organization
        hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      } else if (
        targetCollection &&
        targetCollection['@type'] === 'Graph' &&
        targetCollection.version != null
      ) {
        // release, only user with admin access to the graph can change it
        // release can only be updated to add styles or editorial comment
        hasPermission =
          check.isAdmin ||
          (check(action.agent) && check([scopeId, 'AdminPermission']));
      } else {
        // Graph, Periodical, Issue or CssVariable
        // TODO ? only allow update action on graph if user has PerformActionPermission on an active CreateReleaseAction or PublishAction (see checkDeleteAcl for implementation). Not sure if should be done here or on the workflow validation (librarian#ensureWorkflowCompliance)
        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            (check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'WritePermission'])));
      }
      break;
    }

    case 'AuthorizeContributorAction': {
      const { scopeId, object } = await getObjectData(action);

      if (object['@type'] === 'Graph') {
        const periodical = await this.get(getRootPartId(object), {
          store,
          acl: false
        });

        let permissionScope = action.recipient.roleName;
        // if permissionScope is undefined, it may be because the recipient
        // is specified as a role reference to a Periodical role
        // we try to reconcile here.
        if (permissionScope == null) {
          const periodicalRole = findRole(action.recipient, periodical);
          if (periodicalRole && periodicalRole.roleName) {
            permissionScope = periodicalRole.roleName;
          }
        }
        if (!permissionScope) {
          throw createError(400, 'Invalid recipient for InviteAction');
        }

        // recipient userId must be listed in Graph or present in the Periodical
        hasPermission =
          check.isAdmin ||
          (getActiveRoles(periodical)
            .concat(getActiveRoles(object))
            .some(role => {
              return (
                getId(role) === getId(action.recipient) ||
                getAgentId(role) === getId(action.recipient) ||
                getAgentId(role) === getAgentId(action.recipient)
              );
            }) &&
            (check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'WritePermission'])) &&
            check([scopeId, 'InvitePermission', permissionScope]));
      } else {
        // Periodical and Organization

        // recipient userId must be listed in object
        hasPermission =
          check.isAdmin ||
          (getActiveRoles(object).some(role => {
            return (
              getId(role) === getId(action.recipient) ||
              getAgentId(role) === getId(action.recipient) ||
              getAgentId(role) === getAgentId(action.recipient)
            );
          }) &&
            check([scopeId, 'AdminPermission']));
      }
      break;
    }

    case 'DeauthorizeContributorAction': {
      const { scopeId, object } = await getObjectData(action);

      if (object['@type'] === 'Organization') {
        hasPermission =
          check.isAdmin || check([getId(object), 'AdminPermission']);
      } else {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) && check([scopeId, 'AdminPermission']));
      }
      break;
    }

    case 'ApplyAction': {
      hasPermission = check.isAdmin || check(action.agent);
      break;
    }

    case 'InviteAction': {
      const { scopeId, object } = await getObjectData(action);
      if (object['@type'] === 'Graph') {
        let permissionScope = action.recipient.roleName;
        // if permissionScope is undefined, it may be because the recipient
        // is specified as a role reference to a Periodical role
        // we try to reconcile here.
        if (permissionScope == null) {
          const periodical = await this.get(getRootPartId(object), {
            store,
            acl: false
          });

          const periodicalRole = findRole(action.recipient, periodical);
          if (periodicalRole && periodicalRole.roleName) {
            permissionScope = periodicalRole.roleName;
          }
        }
        if (!permissionScope) {
          throw createError(400, 'Invalid recipient for InviteAction');
        }

        hasPermission =
          check.isAdmin ||
          ((check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission'])) &&
            check([scopeId, 'InvitePermission', permissionScope]));
      } else {
        // Periodical and Organization
        hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      }
      break;
    }

    case 'JoinAction': {
      const { objectId: scopeId, object } = await getObjectData(action);

      if (object['@type'] === 'Graph') {
        const contribRoles = getGraphMainEntityContributorRoles(object);
        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            (check([scopeId, 'AdminPermission']) ||
              contribRoles.some(role => check(role))));
      } else {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) && check([scopeId, 'AdminPermission']));
      }
      break;
    }

    case 'LeaveAction': {
      const { scopeId, object } = await getObjectData(action);

      if (object['@type'] === 'Organization') {
        hasPermission =
          check.isAdmin || check([getId(object), 'AdminPermission']);
      } else {
        hasPermission =
          check.isAdmin ||
          ((check(action.agent) &&
            (check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'ReadPermission']) ||
              check([scopeId, 'WritePermission']))) ||
            (arrayify(action.participant).some(participant =>
              check(participant)
            ) &&
              check([scopeId, 'AdminPermission'])));
      }
      break;
    }

    case 'CheckAction': {
      const { scopeId } = await getObjectData(action);
      hasPermission = check.isAdmin || check(action.agent, { scopeId });
      break;
    }

    case 'AcceptAction':
    case 'RejectAction': {
      const { object } = await getObjectData(action);
      if (object['@type'] === 'InviteAction') {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            arrayify(object.recipient).some(recipient => {
              return check(recipient);
            }));
      } else if (object['@type'] === 'ApplyAction') {
        hasPermission =
          check.isAdmin ||
          (check(action.agent) &&
            check([
              getObjectId(object), // objectId is a journal
              'AdminPermission'
            ]));
      } else {
        hasPermission = false;
      }
      break;
    }

    case 'RequestArticleAction': {
      const { scopeId } = await getObjectData(action);
      hasPermission =
        check.isAdmin ||
        check(action.agent) ||
        check([scopeId, 'AdminPermission']) ||
        check([scopeId, 'WritePermission']);
      break;
    }

    default:
      hasPermission = check.isAdmin;
      break;
  }

  if (!hasPermission) {
    throw createError(
      403,
      `Not allowed to perform ${action['@type'] || 'action'}`
    );
  }
}
