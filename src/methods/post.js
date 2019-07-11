import omit from 'lodash/omit';
import pick from 'lodash/pick';
import isPlainObject from 'lodash/isPlainObject';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { validateInformAction } from '../validators';
import handleRegisterAction from '../handlers/handle-register-action';
import handleCreateAuthenticationTokenAction from '../handlers/handle-create-authentication-token-action';
import handleCreateWorkflowSpecificationAction from '../handlers/handle-create-workflow-specification-action';
import handleCreateGraphAction from '../handlers/handle-create-graph-action';
import handleTagAction from '../handlers/handle-tag-action';
import handleCreatePeriodicalAction from '../handlers/handle-create-periodical-action';
import handleAuthorizeAction from '../handlers/handle-authorize-action';
import handleDeauthorizeAction from '../handlers/handle-deauthorize-action';
import handleAuthorizeContributorAction from '../handlers/handle-authorize-contributor-action';
import handleDeauthorizeContributorAction from '../handlers/handle-deauthorize-contributor-action';
import handleInviteAction from '../handlers/handle-invite-action';
import handleApplyAction from '../handlers/handle-apply-action';
import handleUpdateAction from '../handlers/handle-update-action';
import handleUpdatePasswordAction from '../handlers/handle-update-password-action';
import handleResetPasswordAction from '../handlers/handle-reset-password-action';
import handleWebifyAction from '../handlers/handle-webify-action';
import handleDeactivateAction from '../handlers/handle-deactivate-action';
import handleCancelAction from '../handlers/handle-cancel-action';
import handleActivateAction from '../handlers/handle-activate-action';
import handleCommentAction from '../handlers/handle-comment-action';
import handleInformAction from '../handlers/handle-inform-action';
import handleReplyAction from '../handlers/handle-reply-action';
import handleJoinAction from '../handlers/handle-join-action';
import handleLeaveAction from '../handlers/handle-leave-action';
import handleAcceptAction from '../handlers/handle-accept-action';
import handleRejectAction from '../handlers/handle-reject-action';
import handleCreateOrganizationAction from '../handlers/handle-create-organization-action';
import handleAssignAction from '../handlers/handle-assign-action';
import handleUnassignAction from '../handlers/handle-unassign-action';
import handleCreateServiceAction from '../handlers/handle-create-service-action';
import handleBuyAction from '../handlers/handle-buy-action';
import handleCheckAction from '../handlers/handle-check-action';
import handleCreatePublicationTypeAction from '../handlers/handle-create-publication-type-action';
import handleAssignContactPointAction from '../handlers/handle-assign-contact-point-action';
import handleUnassignContactPointAction from '../handlers/handle-unassign-contact-point-action';
import handleUpdateContactPointAction from '../handlers/handle-update-contact-point-action';
import handleEndorseAction from '../handlers/handle-endorse-action';
import handlePayAction from '../handlers/handle-pay-action';
import handleTypesettingAction from '../handlers/handle-typesetting-action';
import handleDeclareAction from '../handlers/handle-declare-action';
import handleCreateReleaseAction from '../handlers/handle-create-release-action';
import handleReviewAction from '../handlers/handle-review-action';
import handleAssessAction from '../handlers/handle-assess-action';
import handleScheduleAction from '../handlers/handle-schedule-action';
import handlePublishAction from '../handlers/handle-publish-action';
import handleArchiveAction from '../handlers/handle-archive-action';
import handleCreateSpecialPublicationIssueAction from '../handlers/handle-create-special-publication-issue-action';
import handleCreatePublicationIssueAction from '../handlers/handle-create-publication-issue-action';
import handleUploadAction from '../handlers/handle-upload-action';
import handleCreatePaymentAccountAction from '../handlers/handle-create-payment-account-action';
import handleCreateCustomerAccountAction from '../handlers/handle-create-customer-account-action';
import handleSubscribeAction from '../handlers/handle-subscribe-action';
import handleRequestArticleAction from '../handlers/handle-request-article-action';
import Store from '../utils/store';
import { isActionAssigned } from '../acl';
import { getAgentId, getObjectId } from '../utils/schema-utils';

/**
 * Persist the action (if appropriate) and handle the side effects (if any).
 */
export default async function post(action, opts = {}) {
  const {
    now = new Date().toISOString(),
    referer, // comes from req.headers.referer and usefull for InformAction
    webify = true, // send to workers (mostly used for testing)
    isRetrying = false, // used for `processStory` in the CLI to retry from the outside
    acl,
    triggered,
    createCertificate,
    store = new Store(),
    rpc = false,
    rpcTimeout,
    tokenId,
    skipPayments = this.config.skipPayments,
    anonymize = false,
    mode = 'node', // `node` or `document` (governs if we return the full document or just the relevant nodes as result of an update action). Mostly relevant for embedded objects like roles. Updating a role can return the updated role or the updating containing document (e.g periodical) containing the updated role
    fromAction, // the action that called another this.post
    strict = true, // setting to false allows to skip email validation for RegisterAction and similar actions
    addTriggeredActionToResult = false // return a list of actions including the triggered actions instead of `action`
  } = opts;

  this.log.trace({ action, opts }, 'librarian.post');

  if (!isPlainObject(action)) {
    throw createError(400, 'invalid action, action needs to be an object');
  }

  // store informAction in their own documents
  let informActions = arrayify(action.potentialAction).filter(
    potentialAction => potentialAction['@type'] === 'InformAction'
  );

  // Validate potential actions: only InformAction
  if (!triggered) {
    if (arrayify(action.potentialAction).length !== informActions.length) {
      throw createError(
        400,
        `Invalid ${action['@type'] ||
          'action'}, potentialAction can only contain Inform Actions`
      );
    }
    action = omit(action, ['potentialAction']);
  }

  if (informActions.length) {
    const messages = informActions.reduce((messages, informAction) => {
      return messages.concat(validateInformAction(informAction));
    }, []);
    if (messages.length) {
      throw createError(400, messages.join(' '));
    }
  }

  action = await this.resolve(action, { store, strict });
  let prevAction;
  [action, prevAction] = await validateAction.call(this, action, {
    store,
    isRetrying
  });

  // Prevent to re-issue informAction:
  // - for workflow action: the user cannot POST a workflow action with a potential action prop
  // - for other actions: potential action can only be set the first time with the exception of activated queued InviteAction (when we queue invites, first InviteAction is in PotentialActionStatus and second one in ActivateActionStatus)
  if (
    prevAction &&
    informActions.length &&
    // escape hatch for activated queued invite actions
    !(prevAction['@type'] === 'InviteAction') &&
    prevAction.actionStatus === 'PotentialActionStatus' &&
    action['@type'] === 'InviteAction' &&
    action.actionStatus === 'ActiveActionStatus'
  ) {
    throw createError(
      400,
      `${action['@type']} cannot have a defined potentialAction`
    );
  }

  await this.checkWriteAcl(action, { acl, store });

  const lock = await this.createWorkflowActionLock(action, {
    store,
    triggered,
    now
  });

  try {
    // For workflow actions we run the triggers for `AuthorizeAction`,
    // `CommentAction` and `EndorseAction` first so that user can retry if this
    // fails (the triggering action remains unchanged so it can be retried untill
    // all the triggered actions are successfully executed)
    // =>
    // 1. we run the handler with `sideEffects` set to `false` first (mostly to
    //    validate the triggering action)
    // 2. we run triggers only for triggered action of type `AuthorizeAction`,
    //   `CommentAction` and `EndorseAction`
    // 3. re-run the handler with `sideEffects` set to `true`
    // 4. re-run the triggers (without restriction)
    if (
      action['@type'] === 'EndorseAction' ||
      action['@type'] === 'DeclareAction' ||
      action['@type'] === 'CreateReleaseAction' ||
      action['@type'] === 'ReviewAction' ||
      action['@type'] === 'AssessAction' ||
      action['@type'] === 'PublishAction' ||
      action['@type'] === 'PayAction' ||
      action['@type'] === 'TypesettingAction'
    ) {
      const preHandledAction = await handleAction.call(this, action, {
        now,
        referer,
        acl,
        isRetrying,
        webify,
        store,
        prevAction,
        triggered,
        createCertificate,
        mode,
        rpc,
        rpcTimeout,
        tokenId,
        fromAction,
        skipPayments,
        strict,
        sideEffects: false
      });

      await this.handleTriggers(preHandledAction, {
        store,
        strict,
        triggeredActionTypes: [
          'AuthorizeAction',
          'CommentAction',
          'EndorseAction'
        ]
      });
    }

    let handledAction = await handleAction.call(this, action, {
      now,
      referer,
      acl,
      isRetrying,
      webify,
      store,
      prevAction,
      triggered,
      createCertificate,
      mode,
      rpc,
      rpcTimeout,
      tokenId,
      fromAction,
      skipPayments,
      strict,
      sideEffects: true
    });

    // now that action has been stored, be sure that the InformActions have a valid object (just the @id as the handler will fetch it)
    informActions = informActions.map(informAction => {
      return Object.assign({}, informAction, {
        object: getId(handledAction)
      });
    });

    let handledInformActions;
    try {
      handledInformActions = await this.handlePotentialInformActions(
        informActions,
        handledAction,
        { acl, triggered, store, strict, referer }
      );
    } catch (err) {
      // Note: this should rarely happen (errors are persisted in `handledInformActions` in `FailedActionStatus`)
      this.log.error(
        { err, handledAction, informActions },
        'error during handlePotentialInformActions'
      );
      throw err;
    }

    // Handle triggers
    let triggeredActions;
    try {
      triggeredActions = await this.handleTriggers(action, {
        store,
        strict
      });
    } catch (err) {
      this.log.error({ err, handledAction }, 'error during handleTriggers');
      throw err;
    }

    this.log.debug(
      {
        action: handledAction,
        informActions: handledInformActions,
        triggeredActions,
        opts
      },
      'librarian.post completed'
    );

    // Re-embed triggered action and inform action when possible

    // replace handled action by triggeredAction result
    // this typically happens for potential AuthorizeAction (the result of the
    // AuthorizeAction is the handledAction but with an updated audience (`participant`)
    if (
      triggeredActions.some(
        triggeredAction =>
          getId(triggeredAction.result) === getId(handledAction)
      )
    ) {
      // there can be several triggeredAction resulting in the `handledAction`
      // (e.g AuthorizeAction _and_ EndorseAction)
      // we select the one with the highest _rev => the one in the store
      handledAction = await this.get(handledAction, { store, acl: false });
    }

    const overwrite = {};

    // re-embed result of `handledAction` if it is a triggeredAction (typically used for EndorsedAction)
    if (getId(handledAction.result)) {
      const triggeredResult = triggeredActions.find(
        triggeredAction =>
          getId(triggeredAction) === getId(handledAction.result)
      );
      if (triggeredResult) {
        overwrite.result = Object.assign(
          {},
          // may have added potentialAction not present in triggeredResult
          isPlainObject(handledAction.result)
            ? pick(handledAction.result, ['potentialAction'])
            : undefined,
          triggeredResult
        );
      }
    }

    // attach relevant triggered actions to potentialAction
    if (getId(handledAction)) {
      const triggeredPotentialActions = triggeredActions.filter(
        triggeredAction => getObjectId(triggeredAction) === getId(handledAction)
      );

      if (triggeredPotentialActions.length) {
        overwrite.potentialAction = arrayify(
          handledAction.potentialAction
        ).concat(triggeredPotentialActions);
      }
    }

    if (handledInformActions && handledInformActions.length) {
      overwrite.potentialAction = arrayify(
        overwrite.potentialAction || handledAction.potentialAction
      ).concat(handledInformActions);
    }

    handledAction = Object.assign({}, handledAction, overwrite);

    const payload = addTriggeredActionToResult
      ? [handledAction].concat(arrayify(triggeredActions))
      : handledAction;

    var anonymized = await this.anonymize(payload, {
      viewer: String(acl) === 'true' ? this.userId : getAgentId(acl),
      anonymize,
      store
    });
  } catch (err) {
    throw err;
  } finally {
    if (lock) {
      try {
        await lock.unlock();
      } catch (err) {
        this.log.error(
          { err },
          'could not release lock, but it will auto expire'
        );
      }
    }
  }

  return anonymized;
}

/**
 * Note: this doesn't do workflow validation, just very general validation of
 * constraints valid for any action
 */
async function validateAction(action, { store, isRetrying } = {}) {
  if (
    action.actionStatus &&
    action.actionStatus !== 'PotentialActionStatus' &&
    action.actionStatus !== 'ActiveActionStatus' &&
    action.actionStatus !== 'StagedActionStatus' &&
    action.actionStatus !== 'EndorsedActionStatus' &&
    action.actionStatus !== 'CanceledActionStatus' &&
    action.actionStatus !== 'CompletedActionStatus' &&
    action.actionStatus !== 'FailedActionStatus'
  ) {
    throw createError(400, `invalid actionStatus: ${action.actionStatus}`);
  }

  if (!action['@type'] || typeof action['@type'] !== 'string') {
    throw createError(400, 'action must have a @type');
  }

  // get previous action
  let prevAction;
  try {
    prevAction = await this.get(getId(action), { acl: false, store });
  } catch (err) {
    if (err.code !== 404) {
      throw err;
    }
  }

  if (isRetrying) {
    return [action, prevAction];
  }

  // immutable properties
  if (prevAction) {
    if (prevAction && prevAction['@type'] !== action['@type']) {
      throw createError(403, 'Not allowed: @type cannot be mutated');
    }

    // check that recipient was not mutated
    if (prevAction && prevAction.recipient) {
      const prevRecipient = unrole(prevAction.recipient, 'recipient');
      const prevRecipientId = getId(prevRecipient) || prevRecipient.email;

      const recipient = unrole(action.recipient, 'recipient');
      const recipientId = getId(recipient) || recipient.email;
      if (prevRecipientId !== recipientId) {
        throw createError(
          403,
          `Not allowed: recipient identity cannot be mutated ${getId(
            action
          )} (${action['@type']})}`
        );
      }
    }

    // startTime, endTime, pendingEndorsementTime cannot be mutated
    const mutatedTimes = [
      'startTime',
      'endTime',
      'pendingEndorsementTime'
    ].filter(p => {
      return (
        prevAction[p] &&
        action[p] &&
        action[p] !== prevAction[p] &&
        // Special case for endTime: user can cancel and action, but the worker can try to POST it (race condition)
        (p !== 'endTime' || prevAction.actionStatus !== 'CanceledActionStatus')
      );
    });
    if (mutatedTimes.length) {
      throw createError(
        403,
        `Not allowed: ${mutatedTimes
          .map(p => `${p} ${prevAction[p]} -> ${action[p]}`)
          .join(', ')} cannot be mutated ${getId(action)} (${action['@type']} ${
          prevAction.actionStatus
        } -> ${action.actionStatus})}`
      );
    }

    // Action cannot be edited after completion
    if (prevAction.actionStatus === 'CompletedActionStatus') {
      throw createError(
        403,
        `Not allowed: action with actionStatus of CompletedActionStatus cannot be mutated ${getId(
          action
        )} (${action['@type']})}`
      );
    }

    // validate agent changes:
    if (
      isActionAssigned(prevAction) &&
      getAgentId(action.agent) !== getAgentId(prevAction.agent) &&
      getAgentId(action.agent) !== getId(prevAction.agent) // case when the action just list a ref to a role
      // this test also takes into account unassignments
    ) {
      throw createError(
        403,
        `Not allowed: re-assignment and unassignments need to be performed through an AssignAction or an UnassignAction ${getId(
          action
        )} (${action['@type']})}`
      );
    }

    // validate expectedDuration changes:
    if (
      action.expectedDuration && // this may be undefined and that's fine if user only update certain props (e.g user mark an DeclareAction as Completed by just sending the @id, @type, agent and actionStatus
      prevAction.expectedDuration &&
      prevAction.expectedDuration !== action.expectedDuration
    ) {
      throw createError(
        403,
        `Not allowed: action can only be rescheduled through a ScheduleAction ${getId(
          action
        )} (${action['@type']})}`
      );
    }

    await this.ensureWorkflowActionStateMachineStatus(prevAction, { store });
  }

  return [action, prevAction];
}

async function handleAction(
  action,
  {
    now,
    referer,
    store,
    acl,
    webify,
    triggered,
    prevAction,
    createCertificate,
    rpc,
    rpcTimeout,
    mode,
    tokenId,
    fromAction,
    strict,
    isRetrying,
    skipPayments,
    sideEffects
  } = {}
) {
  const opts = {
    now,
    referer,
    store,
    acl,
    webify,
    triggered,
    prevAction,
    createCertificate,
    rpc,
    rpcTimeout,
    mode,
    tokenId,
    uploadAction: fromAction,
    strict,
    isRetrying,
    skipPayments,
    sideEffects
  };

  let handledAction;
  switch (action['@type']) {
    case 'RegisterAction':
      handledAction = await handleRegisterAction.call(this, action, opts);
      break;

    case 'SubscribeAction':
      handledAction = await handleSubscribeAction.call(this, action, opts);
      break;

    case 'CreatePaymentAccountAction':
      handledAction = await handleCreatePaymentAccountAction.call(
        this,
        action,
        opts
      );
      break;

    case 'CreateCustomerAccountAction':
      handledAction = await handleCreateCustomerAccountAction.call(
        this,
        action,
        opts
      );
      break;

    case 'RequestArticleAction':
      handledAction = await handleRequestArticleAction.call(this, action, opts);
      break;

    case 'CreateAuthenticationTokenAction':
      handledAction = await handleCreateAuthenticationTokenAction.call(
        this,
        action,
        opts
      );
      break;

    // workflow actions
    case 'TypesettingAction':
      handledAction = await handleTypesettingAction.call(this, action, opts);
      break;

    case 'ArchiveAction':
      handledAction = await handleArchiveAction.call(this, action, opts);
      break;

    case 'DeclareAction':
      handledAction = await handleDeclareAction.call(this, action, opts);
      break;

    case 'PayAction':
      handledAction = await handlePayAction.call(this, action, opts);
      break;

    case 'CreateReleaseAction':
      handledAction = await handleCreateReleaseAction.call(this, action, opts);
      break;

    case 'ReviewAction':
      handledAction = await handleReviewAction.call(this, action, opts);
      break;

    case 'AssessAction':
      handledAction = await handleAssessAction.call(this, action, opts);
      break;

    case 'PublishAction':
      handledAction = await handlePublishAction.call(this, action, opts);
      break;

    case 'ScheduleAction':
      handledAction = await handleScheduleAction.call(this, action, opts);
      break;

    case 'BuyAction':
      handledAction = await handleBuyAction.call(this, action, opts);
      break;

    case 'CheckAction':
      handledAction = await handleCheckAction.call(this, action, opts);
      break;

    case 'CreateWorkflowSpecificationAction':
      handledAction = await handleCreateWorkflowSpecificationAction.call(
        this,
        action,
        opts
      );
      break;

    case 'EndorseAction':
      handledAction = await handleEndorseAction.call(this, action, opts);
      break;

    case 'CreateGraphAction':
      handledAction = await handleCreateGraphAction.call(this, action, opts);
      break;

    case 'CreatePublicationTypeAction':
      handledAction = await handleCreatePublicationTypeAction.call(
        this,
        action,
        opts
      );
      break;

    case 'CreateServiceAction':
      handledAction = await handleCreateServiceAction.call(this, action, opts);
      break;

    case 'AssignAction':
      handledAction = await handleAssignAction.call(this, action);
      break;

    case 'UnassignAction':
      handledAction = await handleUnassignAction.call(this, action);
      break;

    case 'AssignContactPointAction':
      handledAction = await handleAssignContactPointAction.call(
        this,
        action,
        opts
      );
      break;

    case 'UnassignContactPointAction':
      handledAction = await handleUnassignContactPointAction.call(
        this,
        action,
        opts
      );
      break;

    case 'UpdateContactPointAction':
      handledAction = await handleUpdateContactPointAction.call(
        this,
        action,
        opts
      );
      break;

    case 'TagAction':
      handledAction = await handleTagAction.call(this, action, opts);
      break;

    case 'CreatePeriodicalAction':
      handledAction = await handleCreatePeriodicalAction.call(
        this,
        action,
        opts
      );
      break;

    case 'CreatePublicationIssueAction':
      handledAction = await handleCreatePublicationIssueAction.call(
        this,
        action,
        opts
      );
      break;

    case 'CreateSpecialPublicationIssueAction':
      handledAction = await handleCreateSpecialPublicationIssueAction.call(
        this,
        action,
        opts
      );
      break;

    case 'AuthorizeAction':
      handledAction = await handleAuthorizeAction.call(this, action, opts);
      break;

    case 'DeauthorizeAction':
      handledAction = await handleDeauthorizeAction.call(this, action, opts);
      break;

    case 'AuthorizeContributorAction':
      handledAction = await handleAuthorizeContributorAction.call(
        this,
        action,
        opts
      );
      break;

    case 'DeauthorizeContributorAction':
      handledAction = await handleDeauthorizeContributorAction.call(
        this,
        action,
        opts
      );
      break;

    case 'UpdateAction':
      handledAction = await handleUpdateAction.call(this, action, opts);
      break;

    case 'UpdatePasswordAction':
      handledAction = await handleUpdatePasswordAction.call(this, action, opts);

      break;

    case 'ResetPasswordAction':
      handledAction = await handleResetPasswordAction.call(this, action, opts);
      break;

    case 'DocumentProcessingAction':
    case 'ImageProcessingAction':
    case 'AudioVideoProcessingAction':
      handledAction = await handleWebifyAction.call(this, action, opts);
      break;

    case 'ActivateAction':
      handledAction = await handleActivateAction.call(this, action, opts);

      break;

    case 'DeactivateAction':
      handledAction = await handleDeactivateAction.call(this, action, opts);
      break;

    case 'CancelAction':
      handledAction = await handleCancelAction.call(this, action, opts);
      break;

    case 'CommentAction':
      handledAction = await handleCommentAction.call(this, action, opts);
      break;

    case 'InformAction':
      handledAction = await handleInformAction.call(this, action, opts);
      break;

    case 'ReplyAction':
      handledAction = await handleReplyAction.call(this, action, opts);
      break;

    case 'ApplyAction':
      handledAction = await handleApplyAction.call(this, action, opts);
      break;

    case 'InviteAction':
      handledAction = await handleInviteAction.call(this, action, opts);
      break;

    case 'AcceptAction':
      handledAction = await handleAcceptAction.call(this, action, opts);
      break;

    case 'RejectAction':
      handledAction = await handleRejectAction.call(this, action, opts);
      break;

    case 'JoinAction':
      handledAction = await handleJoinAction.call(this, action, opts);
      break;

    case 'LeaveAction':
      handledAction = await handleLeaveAction.call(this, action, opts);
      break;

    case 'CreateOrganizationAction':
      handledAction = await handleCreateOrganizationAction.call(
        this,
        action,
        opts
      );
      break;

    case 'UploadAction':
      handledAction = await handleUploadAction.call(this, action, opts);
      break;

    default:
      throw createError(400, `unsupported action ${action['@type']}`);
  }

  return handledAction;
}
