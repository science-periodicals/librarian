// High level API
import bunyan from 'bunyan';
import stripe from 'stripe';
import { parseUsername } from './acl';
import addPromiseSupport from './utils/add-promise-support';
import addCallbackSupport from './utils/add-callback-support';
import createIoSource from './methods/create-io-source';
import close from './methods/close';
import head from './methods/head';
import login from './methods/login';
import logout from './methods/logout';
import session from './methods/session';
import checkCouchLogin from './methods/check-couch-login';
import getMethod from './methods/get';
import put from './methods/put';
import update from './methods/update';
import post from './methods/post';
import createNash from './methods/create-nash';
import deleteMethod from './methods/delete';
import ensureWorkflowCompliance from './methods/ensure-workflow-compliance';
import ensureServiceCompliance from './methods/ensure-service-compliance';
import search from './methods/search';
import hydrate from './methods/hydrate';
import getLatestVersion from './methods/get-latest-version';
import instantiateWorkflowStage from './methods/instantiate-workflow-stage';
import dispatch from './methods/dispatch';
import publish from './methods/publish';
import deleteBlobs from './methods/delete-blobs';
import createLock from './methods/create-lock';
import createWorkflowActionLock from './methods/create-workflow-action-lock';
import createBlob from './methods/create-blob';
import deleteBlob from './methods/delete-blob';
import deleteScope from './methods/delete-scope';
import upload from './methods/upload';
import resolve from './methods/resolve';
import handleStripeEvent from './methods/handle-stripe-event';
import handleTriggers from './methods/handle-triggers';
import handlePotentialInformActions from './methods/handle-potential-inform-actions';
import anonymize from './methods/anonymize';
import createInvoiceItem from './methods/create-invoice-item';
import createUsageRecord from './methods/create-usage-record';
import createCharge from './methods/create-charge';
import registerDois from './methods/register-dois';
import validateContactPointEmail from './methods/validate-contact-point-email';
import changePassword from './methods/change-password';
import validateAndSetupNodeIds from './methods/validate-and-setup-node-ids';
import resolveRecipients from './methods/resolve-recipients';
import {
  hasUniqId,
  hasActiveSubscribeActionId,
  hasCreateCustomerAccountActionId,
  hasCreatePaymentAccountActionId,
  addUniqId,
  removeUniqId,
  syncUniqIds
} from './methods/uniq-id';
import {
  syncWorkflowActionDataSummary,
  getWorkflowActionDataSummary,
  ensureAllWorkflowActionsStateMachineStatus,
  ensureWorkflowActionStateMachineStatus
} from './methods/workflow-action-data';

// acl
import checkPublicAvailability from './methods/check-public-availability';
import checkAcl from './methods/check-acl';
import checkReadAcl from './methods/check-read-acl';
import checkReadAclSync from './methods/check-read-acl-sync';
import checkWriteAcl from './methods/check-write-acl';
import checkDeleteAcl from './methods/check-delete-acl';

// sync
import syncGraph from './methods/sync-graph';
import syncWorkflow from './methods/sync-workflow';
import syncIssue from './methods/sync-issue';
import syncParticipants from './methods/sync-participants';
import syncCheckActions from './methods/sync-check-actions';

// views
import getUserOrganizations from './views/get-user-organizations';
import getProfilesByEmail from './views/get-profiles-by-email';
import getProfileByEmail from './views/get-profile-by-email';
import getAppSuiteUser from './views/get-app-suite-user';
import getPeriodicalsByOrganizationId from './views/get-periodicals-by-organization-id';
import getGraphsByPeriodicalId from './views/get-graphs-by-periodical-id';
import getProfilesByMemberOfId from './views/get-profiles-by-member-of-id';
import getByCreatorIdAndType from './views/get-by-creator-id-and-type';
import getEmbedderByEmbeddedId from './views/get-embedder-by-embedded-id';
import getVisibleTagIds from './views/get-visible-tag-ids';
import getActiveInviteActionByRecipientIdOrEmail from './views/get-active-invite-action-by-recipient-id-or-email';
import getActiveInviteActionsByPurposeId from './views/get-active-invite-actions-by-purpose-id';
import getEncodingCountsByChecksumAndScopeId from './views/get-encoding-counts-by-checksum-and-scope-id';
import getServiceAction from './views/get-service-action';
import getServiceByOfferId from './views/get-service-by-offer-id';
import getTriggeredActionsByTriggeringIdAndTriggerType from './views/get-triggered-actions-by-triggering-id-and-trigger-type';
import getPublishActionsBySlug from './views/get-publish-actions-by-slug';
import getServiceByServiceOutputId from './views/get-service-by-service-output-id';
import getActionsByStageIdAndTemplateId from './views/get-actions-by-stage-id-and-template-id';
import getBlockedActionsByBlockingActionIdsAndStageId from './views/get-blocked-actions-by-blocking-action-ids-and-stage-id';
import getActionsByObjectIdAndType from './views/get-actions-by-object-id-and-type';
import getActionsByScopeIdAndTypes from './views/get-actions-by-scope-id-and-types';
import getActionTemplateByTemplateId from './views/get-action-template-by-template-id';
import getActionsByObjectId from './views/get-actions-by-object-id';
import getWorkflowActionsByStageId from './views/get-workflow-actions-by-stage-id';
import getTypesettingActionsByScopeIds from './views/get-typesetting-actions-by-scope-ids';
import getChildCommentActions from './views/get-child-comment-actions';
import getScopeDocs from './views/get-scope-docs';
import getPendingEncodingByContentUrl from './views/get-pending-encoding-by-content-url';
import getEncodingByContentUrl from './views/get-encoding-by-content-url';
import getLatestReleasesByIssueId from './views/get-latest-releases-by-issue-id';
import getLatestReleasesCoveredByIssue from './views/get-latest-releases-covered-by-issue';
import getLatestReleasePublicationIssueId from './views/get-latest-release-publication-issue-id';
import getActionsByObjectScopeId from './views/get-actions-by-object-scope-id';
import getActionsByScopeId from './views/get-actions-by-scope-id';
import getInstantiatedStagesByGraphIdAndTemplateId from './views/get-instantiated-stages-by-graph-id-and-template-id';
import getProxyUserByAuthenticationToken from './views/get-proxy-user-by-authentication-token';
import getStripeAccountByOrganizationId from './views/get-stripe-account-by-organization-id';
import getStripeCustomerByOrganizationId from './views/get-stripe-customer-by-organization-id';
import getActiveSubscribeAction from './views/get-active-subscribe-action';
import getStripeObject from './views/get-stripe-object';
import getExpiredActiveRegisterActions from './views/get-expired-active-register-actions';
import getActiveRegisterActionByUserId from './views/get-active-register-action-by-user-id';
import getActiveRegisterActionsByEmail from './views/get-active-register-actions-by-email';
import getActiveGraphRoleIdsByUserId from './views/get-active-graph-role-ids-by-user-id';
import getActionsByInstrumentOfId from './views/get-actions-by-instrument-of-id';
import getActionsByTemplateIdsAndScopeId from './views/get-actions-by-template-ids-and-scope-id';
import getActiveUploadCountsByIdentifier from './views/get-active-upload-counts-by-identifier';
import getUnroledIdToRoleIdMap from './views/get-unroled-id-to-role-id-map';
import getServicesByBrokerId from './views/get-services-by-broker-id';
import getCouchDbRoles from './views/get-couch-db-roles';
import getUpcomingInvoice from './views/get-upcoming-invoice';
import getInvoices from './views/get-invoices';
import getInvoice from './views/get-invoice';
import getActionsByResultId from './views/get-actions-by-result-id';
import getUserRoles from './views/get-user-roles';

class Librarian {
  /**
   * typical call is with a express request: new Librarian(req)
   */
  constructor(config = {}, opts) {
    // config can be passed from an express request
    const maybeReq = opts || config;
    const req = maybeReq.app ? maybeReq : {}; // detect if we have an express request

    this.config = Object.assign(
      {
        // default to test crossref params (overwrite to use prod ones (not checked on github))
        crossrefDoiRegistrationUrl:
          process.env.CROSSREF_DOI_REGISTRATION_URL ||
          'https://test.crossref.org/servlet/deposit', // see https://support.crossref.org/hc/en-us/articles/214960123-Using-HTTPS-to-POST-Files
        crossrefDoiRegistrationUsername:
          process.env.CROSSREF_DOI_REGISTRATION_USERNAME || 'crossref-username',
        crossrefDoiRegistrationPassword:
          process.env.CROSSREF_DOI_REGISTRATION_PASSWORD || 'crossref-password'
      },
      config.app && config.app.locals && config.app.locals.config
        ? config.app.locals.config
        : config
    );

    // keep in sync with @scipe/workers
    this.BROKER_FRONTEND =
      this.config.brokerFrontendConnectEndpoint ||
      process.env.BROKER_FRONTEND_CONNECT_ENDPOINT ||
      'tcp://127.0.0.1:3003';
    this.XPUB_ENDPOINT =
      this.config.brokerXpubConnectEndpoint ||
      process.env.BROKER_XPUB_CONNECT_ENDPOINT ||
      'tcp://127.0.0.1:3001';
    this.XSUB_ENDPOINT =
      this.config.brokerXsubConnectEndpoint ||
      process.env.BROKER_XSUB_CONNECT_ENDPOINT ||
      'tcp://127.0.0.1:3002';

    // Note: credential validation must be done upstream (e.g using the validateBasicAuthCredentials middleware of `@scienceai/api`)
    this.authHeaders =
      req.authHeaders ||
      (req.session && req.session.couchAuthHeaders) ||
      (req.headers &&
        req.headers['authorization'] && {
          Authorization: req.headers['authorization']
        });

    // Note: credential validation must be done upstream (e.g using the validateBasicAuthCredentials middleware of `@scienceai/api`)
    this.username = parseUsername(req);
    this.userId =
      (req.session && req.session.userId) ||
      (this.username && `user:${this.username}`);

    this.log =
      req.log ||
      bunyan.createLogger(
        Object.assign(
          {
            name: 'librarian',
            serializers: { err: bunyan.stdSerializers.err }
          },
          this.config.log || {}
        )
      );

    this.blobStore = this.createIoSource(
      'blobStore',
      req.app && req.app.locals
    );
    this.redis = this.createIoSource('redis', req.app && req.app.locals);
    this.redlock = this.createIoSource('redlock', req.app && req.app.locals);
    this.db = this.createIoSource('db', req.app && req.app.locals);
    this.view = this.createIoSource('view', req.app && req.app.locals);
    this._search = this.createIoSource('search', req.app && req.app.locals);
    this.authDb = this.createIoSource('authDb', req.app && req.app.locals);
    this.authDbView = this.createIoSource(
      'authDbView',
      req.app && req.app.locals
    );
    this.sendEmail = this.createIoSource('email', req.app && req.app.locals);
    this.tokenStore = this.createIoSource(
      'tokenStore',
      req.app && req.app.locals
    );

    this.stripe = stripe(
      this.config.stripeKey || process.env.STRIPE_KEY || 'sk_test_key'
    );
  }
}

// core sync methods (do not need addPromiseSupport)
Librarian.prototype.createIoSource = createIoSource;
Librarian.prototype.checkReadAclSync = checkReadAclSync;

// core async methods (need addPromiseSupport or addCallbackSupport)
Librarian.prototype.createLock = addCallbackSupport(createLock);
Librarian.prototype.createWorkflowActionLock = addCallbackSupport(
  createWorkflowActionLock
);
Librarian.prototype.upload = addCallbackSupport(upload);
Librarian.prototype.createBlob = addPromiseSupport(createBlob);
Librarian.prototype.deleteBlob = addPromiseSupport(deleteBlob);
Librarian.prototype.deleteScope = addPromiseSupport(deleteScope);

Librarian.prototype.close = addPromiseSupport(close);
Librarian.prototype.head = addPromiseSupport(head);
Librarian.prototype.login = addPromiseSupport(login);
Librarian.prototype.logout = addPromiseSupport(logout);
Librarian.prototype.session = addPromiseSupport(session);
Librarian.prototype.checkCouchLogin = addPromiseSupport(checkCouchLogin);
Librarian.prototype.get = addPromiseSupport(getMethod);
Librarian.prototype.delete = addCallbackSupport(deleteMethod);
Librarian.prototype.deleteBlobs = addPromiseSupport(deleteBlobs);
Librarian.prototype.put = addPromiseSupport(put);
Librarian.prototype.update = addPromiseSupport(update);
Librarian.prototype.post = addCallbackSupport(post);
Librarian.prototype.search = addPromiseSupport(search);
Librarian.prototype.createNash = addPromiseSupport(createNash);
Librarian.prototype.resolve = addCallbackSupport(resolve);

Librarian.prototype.syncGraph = addPromiseSupport(syncGraph);
Librarian.prototype.syncWorkflow = addCallbackSupport(syncWorkflow);
Librarian.prototype.syncIssue = addCallbackSupport(syncIssue);
Librarian.prototype.syncParticipants = addCallbackSupport(syncParticipants);
Librarian.prototype.syncCheckActions = addCallbackSupport(syncCheckActions);

Librarian.prototype.ensureWorkflowCompliance = addCallbackSupport(
  ensureWorkflowCompliance
);
Librarian.prototype.ensureServiceCompliance = addCallbackSupport(
  ensureServiceCompliance
);

Librarian.prototype.checkAcl = addPromiseSupport(checkAcl);
Librarian.prototype.instantiateWorkflowStage = addCallbackSupport(
  instantiateWorkflowStage
);
Librarian.prototype.hydrate = addCallbackSupport(hydrate);
Librarian.prototype.checkPublicAvailability = addCallbackSupport(
  checkPublicAvailability
);
Librarian.prototype.getLatestVersion = addPromiseSupport(getLatestVersion);
Librarian.prototype.checkReadAcl = addPromiseSupport(checkReadAcl);
Librarian.prototype.checkWriteAcl = addCallbackSupport(checkWriteAcl);
Librarian.prototype.checkDeleteAcl = addCallbackSupport(checkDeleteAcl);
Librarian.prototype.dispatch = addPromiseSupport(dispatch);
Librarian.prototype.publish = addPromiseSupport(publish);

Librarian.prototype.anonymize = addCallbackSupport(anonymize);
Librarian.prototype.handleTriggers = addCallbackSupport(handleTriggers);
Librarian.prototype.handlePotentialInformActions = addCallbackSupport(
  handlePotentialInformActions
);

// Needed by the API to honor stipe webhooks
Librarian.prototype.handleStripeEvent = addCallbackSupport(handleStripeEvent);

Librarian.prototype.createInvoiceItem = addCallbackSupport(createInvoiceItem);
Librarian.prototype.createUsageRecord = addCallbackSupport(createUsageRecord);
Librarian.prototype.createCharge = addCallbackSupport(createCharge);
Librarian.prototype.registerDois = addCallbackSupport(registerDois);

Librarian.prototype.validateContactPointEmail = addCallbackSupport(
  validateContactPointEmail
);
Librarian.prototype.changePassword = addPromiseSupport(changePassword);
Librarian.prototype.validateAndSetupNodeIds = addCallbackSupport(
  validateAndSetupNodeIds
);
Librarian.prototype.resolveRecipients = addCallbackSupport(resolveRecipients);

Librarian.prototype.hasUniqId = addPromiseSupport(hasUniqId);
Librarian.prototype.hasActiveSubscribeActionId = addPromiseSupport(
  hasActiveSubscribeActionId
);
Librarian.prototype.hasCreateCustomerAccountActionId = addPromiseSupport(
  hasCreateCustomerAccountActionId
);
Librarian.prototype.hasCreatePaymentAccountActionId = addPromiseSupport(
  hasCreatePaymentAccountActionId
);

Librarian.prototype.addUniqId = addPromiseSupport(addUniqId);
Librarian.prototype.removeUniqId = addPromiseSupport(removeUniqId);
Librarian.prototype.syncUniqIds = addPromiseSupport(syncUniqIds);

Librarian.prototype.syncWorkflowActionDataSummary = addPromiseSupport(
  syncWorkflowActionDataSummary
);
Librarian.prototype.getWorkflowActionDataSummary = addPromiseSupport(
  getWorkflowActionDataSummary
);
Librarian.prototype.ensureAllWorkflowActionsStateMachineStatus = addCallbackSupport(
  ensureAllWorkflowActionsStateMachineStatus
);
Librarian.prototype.ensureWorkflowActionStateMachineStatus = addCallbackSupport(
  ensureWorkflowActionStateMachineStatus
);

// views (all async so need addPromiseSupport)
Librarian.prototype.getUserOrganizations = addPromiseSupport(
  getUserOrganizations
);
Librarian.prototype.getProfilesByEmail = addPromiseSupport(getProfilesByEmail);
Librarian.prototype.getProfileByEmail = addPromiseSupport(getProfileByEmail);
Librarian.prototype.getAppSuiteUser = addPromiseSupport(getAppSuiteUser);
Librarian.prototype.getGraphsByPeriodicalId = addPromiseSupport(
  getGraphsByPeriodicalId
);
Librarian.prototype.getProfilesByMemberOfId = addPromiseSupport(
  getProfilesByMemberOfId
);
Librarian.prototype.getByCreatorIdAndType = addPromiseSupport(
  getByCreatorIdAndType
);
Librarian.prototype.getWorkflowActionsByStageId = addPromiseSupport(
  getWorkflowActionsByStageId
);
Librarian.prototype.getEmbedderByEmbeddedId = addPromiseSupport(
  getEmbedderByEmbeddedId
);
Librarian.prototype.getChildCommentActions = addPromiseSupport(
  getChildCommentActions
);
Librarian.prototype.getVisibleTagIds = addPromiseSupport(getVisibleTagIds);
Librarian.prototype.getActiveInviteActionByRecipientIdOrEmail = addPromiseSupport(
  getActiveInviteActionByRecipientIdOrEmail
);
Librarian.prototype.getActiveInviteActionsByPurposeId = addPromiseSupport(
  getActiveInviteActionsByPurposeId
);

Librarian.prototype.getEncodingCountsByChecksumAndScopeId = addPromiseSupport(
  getEncodingCountsByChecksumAndScopeId
);
Librarian.prototype.getTypesettingActionsByScopeIds = addPromiseSupport(
  getTypesettingActionsByScopeIds
);
Librarian.prototype.getServiceAction = addPromiseSupport(getServiceAction);
Librarian.prototype.getServiceByOfferId = addPromiseSupport(
  getServiceByOfferId
);
Librarian.prototype.getTriggeredActionsByTriggeringIdAndTriggerType = addPromiseSupport(
  getTriggeredActionsByTriggeringIdAndTriggerType
);
Librarian.prototype.getPublishActionsBySlug = addPromiseSupport(
  getPublishActionsBySlug
);
Librarian.prototype.getServiceByServiceOutputId = addPromiseSupport(
  getServiceByServiceOutputId
);
Librarian.prototype.getActionsByStageIdAndTemplateId = addPromiseSupport(
  getActionsByStageIdAndTemplateId
);
Librarian.prototype.getActionTemplateByTemplateId = addPromiseSupport(
  getActionTemplateByTemplateId
);
Librarian.prototype.getBlockedActionsByBlockingActionIdsAndStageId = addPromiseSupport(
  getBlockedActionsByBlockingActionIdsAndStageId
);

Librarian.prototype.getActionsByObjectIdAndType = addPromiseSupport(
  getActionsByObjectIdAndType
);
Librarian.prototype.getActionsByScopeIdAndTypes = addPromiseSupport(
  getActionsByScopeIdAndTypes
);

Librarian.prototype.getActionsByObjectId = addPromiseSupport(
  getActionsByObjectId
);
Librarian.prototype.getScopeDocs = addPromiseSupport(getScopeDocs);
Librarian.prototype.getPeriodicalsByOrganizationId = addPromiseSupport(
  getPeriodicalsByOrganizationId
);

Librarian.prototype.getPendingEncodingByContentUrl = addPromiseSupport(
  getPendingEncodingByContentUrl
);
Librarian.prototype.getEncodingByContentUrl = addPromiseSupport(
  getEncodingByContentUrl
);

Librarian.prototype.getLatestReleasesByIssueId = addPromiseSupport(
  getLatestReleasesByIssueId
);
Librarian.prototype.getLatestReleasesCoveredByIssue = addPromiseSupport(
  getLatestReleasesCoveredByIssue
);
Librarian.prototype.getLatestReleasePublicationIssueId = addPromiseSupport(
  getLatestReleasePublicationIssueId
);
Librarian.prototype.getActionsByObjectScopeId = addPromiseSupport(
  getActionsByObjectScopeId
);
Librarian.prototype.getActionsByScopeId = addPromiseSupport(
  getActionsByScopeId
);
Librarian.prototype.getInstantiatedStagesByGraphIdAndTemplateId = addPromiseSupport(
  getInstantiatedStagesByGraphIdAndTemplateId
);
Librarian.prototype.getProxyUserByAuthenticationToken = addPromiseSupport(
  getProxyUserByAuthenticationToken
);

Librarian.prototype.getStripeAccountByOrganizationId = addPromiseSupport(
  getStripeAccountByOrganizationId
);
Librarian.prototype.getStripeCustomerByOrganizationId = addPromiseSupport(
  getStripeCustomerByOrganizationId
);
Librarian.prototype.getActiveSubscribeAction = addPromiseSupport(
  getActiveSubscribeAction
);
Librarian.prototype.getStripeObject = addPromiseSupport(getStripeObject);
Librarian.prototype.getExpiredActiveRegisterActions = addPromiseSupport(
  getExpiredActiveRegisterActions
);
Librarian.prototype.getActiveRegisterActionByUserId = addPromiseSupport(
  getActiveRegisterActionByUserId
);
Librarian.prototype.getActiveRegisterActionsByEmail = addPromiseSupport(
  getActiveRegisterActionsByEmail
);

Librarian.prototype.getActiveGraphRoleIdsByUserId = addPromiseSupport(
  getActiveGraphRoleIdsByUserId
);
Librarian.prototype.getActionsByInstrumentOfId = addPromiseSupport(
  getActionsByInstrumentOfId
);
Librarian.prototype.getActionsByTemplateIdsAndScopeId = addPromiseSupport(
  getActionsByTemplateIdsAndScopeId
);
Librarian.prototype.getActiveUploadCountsByIdentifier = addPromiseSupport(
  getActiveUploadCountsByIdentifier
);
Librarian.prototype.getUnroledIdToRoleIdMap = addPromiseSupport(
  getUnroledIdToRoleIdMap
);
Librarian.prototype.getServicesByBrokerId = addPromiseSupport(
  getServicesByBrokerId
);
Librarian.prototype.getActionsByResultId = addPromiseSupport(
  getActionsByResultId
);
Librarian.prototype.getCouchDbRoles = addPromiseSupport(getCouchDbRoles);
Librarian.prototype.getUpcomingInvoice = addPromiseSupport(getUpcomingInvoice);
Librarian.prototype.getInvoices = addPromiseSupport(getInvoices);
Librarian.prototype.getInvoice = addPromiseSupport(getInvoice);
Librarian.prototype.getUserRoles = addPromiseSupport(getUserRoles);

export default Librarian;
