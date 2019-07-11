import createError from '@scipe/create-error';
import { getId, getNodeMap } from '@scipe/jsonld';
import {
  getTargetCollectionId,
  getObjectId,
  getResult
} from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import handleUpdateGraphAction from './sub-handlers/handle-update-graph-action';
import handleUpdatePeriodicalAction from './sub-handlers/handle-update-periodical-action';
import handleUpdateRoleAction from './sub-handlers/handle-update-role-action';
import handleUpdateProfileAction from './sub-handlers/handle-update-profile-action';
import handleUpdateOrganizationAction from './sub-handlers/handle-update-organization-action';
import handleUpdatePublicationTypeAction from './sub-handlers/handle-update-publication-type-action';
import handleUpdateServiceAction from './sub-handlers/handle-update-service-action';
import handleUpdateWorkflowSpecificationAction from './sub-handlers/handle-update-workflow-specification-action';
import handleUpdatePublicationIssueAction from './sub-handlers/handle-update-publication-issue-action';
import handleUpdateSpecialPublicationIssueAction from './sub-handlers/handle-update-special-publication-issue-action';
import handleUpdateReleaseAction from './sub-handlers/handle-update-release-action';
import handleUpdateStripeAccountAction from './sub-handlers/handle-update-stripe-account-action';
import handleUpdateStripeCustomerAction from './sub-handlers/handle-update-stripe-customer-action';
import handleUpdateAssetAction from './sub-handlers/handle-update-asset-action';

export default async function handleUpdateAction(
  action,
  {
    store,
    triggered,
    prevAction,
    strict = true,
    mode = 'node' // `node` or `document` (governs if we return the full document or just the relevant nodes as result of an update action). Mostly relevant for embedded objects like roles. Updating a role can return the updated role or the updating containing document (e.g periodical) containing the updated role
  } = {}
) {
  if (!action.targetCollection) {
    throw createError(400, 'UpdateAction must have a valid targetCollection');
  }

  if (action.object == null) {
    throw createError(
      400,
      'UpdateAction must have a valid object containing an update payload'
    );
  }

  let lock;
  if (getId(action)) {
    lock = await this.createLock(getId(action), {
      isLocked: () => {
        return (
          prevAction && prevAction.actionStatus === 'CompletedActionStatus'
        );
      },
      prefix: 'update'
    });
  }

  // top level try / catch to ensure that the lock is released on error
  let handledAction;
  try {
    const targetCollectionId = getTargetCollectionId(action);
    let targetCollection;
    if (targetCollectionId && targetCollectionId.startsWith('stripe:')) {
      targetCollection = await this.getStripeObject(targetCollectionId, {
        store
      });
    } else {
      targetCollection = await this.get(targetCollectionId, {
        store,
        lucene: true,
        acl: false
      });
    }

    if (targetCollectionId.startsWith('stripe:')) {
      switch (targetCollection.object) {
        case 'account':
          handledAction = await handleUpdateStripeAccountAction.call(
            this,
            action,
            targetCollection,
            {
              store,
              triggered,
              prevAction,
              strict
            }
          );
          break;

        case 'customer':
          handledAction = await handleUpdateStripeCustomerAction.call(
            this,
            action,
            targetCollection,
            {
              store,
              triggered,
              prevAction,
              strict
            }
          );
          break;

        default:
          throw createError(
            400,
            'Unsuported target collection. targetCollection with a stripe prefix must be an account, customer or subscription object'
          );
      }
    } else {
      // special case for static assets when object is an UploadAction
      uploadCase: {
        const objectId = getObjectId(action);
        if (objectId && objectId.startsWith('action:')) {
          const uploadAction = await this.get(objectId, { acl: false, store });
          if (uploadAction['@type'] !== 'UploadAction') {
            break uploadCase;
          }

          // For update of Graph @graph resources we call
          // `handleUpdateGraphAction` for the rest (style & assets)
          // `handleUpdateAssetAction`
          const scopeId = getScopeId(uploadAction);
          if (scopeId.startsWith('graph:')) {
            const encoding = getResult(uploadAction);
            if (!encoding) {
              break uploadCase;
            }
            const resourceId = getId(encoding.encodesCreativeWork);
            if (!resourceId) {
              break uploadCase;
            }
            const scope = await this.get(scopeId, { store, acl: false });
            const nodeMap = getNodeMap(scope);

            if (resourceId in nodeMap) {
              handledAction = await handleUpdateGraphAction.call(
                this,
                action,
                targetCollection,
                {
                  store,
                  triggered,
                  prevAction,
                  strict,
                  mode
                }
              );
              break uploadCase;
            }
          }

          handledAction = await handleUpdateAssetAction.call(
            this,
            action,
            uploadAction,
            targetCollection,
            { store, triggered, prevAction, strict, mode }
          );
        }
      }

      if (!handledAction) {
        switch (targetCollection['@type']) {
          case 'Organization':
            handledAction = await handleUpdateOrganizationAction.call(
              this,
              action,
              targetCollection,
              { store, triggered, prevAction, mode, strict }
            );
            break;

          case 'Role':
          case 'ContributorRole':
          case 'ServiceProviderRole':
            handledAction = await handleUpdateRoleAction.call(
              this,
              action,
              targetCollection,
              {
                store,
                triggered,
                prevAction,
                mode,
                strict
              }
            );
            break;

          case 'Person': {
            handledAction = await handleUpdateProfileAction.call(
              this,
              action,
              targetCollection,
              {
                store,
                triggered,
                prevAction,
                mode,
                strict
              }
            );
            break;
          }

          case 'Periodical': {
            handledAction = await handleUpdatePeriodicalAction.call(
              this,
              action,
              targetCollection,
              {
                store,
                triggered,
                prevAction,
                mode,
                strict
              }
            );
            break;
          }

          case 'PublicationType':
            handledAction = await handleUpdatePublicationTypeAction.call(
              this,
              action,
              targetCollection,
              {
                store,
                triggered,
                prevAction,
                mode,
                strict
              }
            );
            break;

          case 'Service':
            handledAction = await handleUpdateServiceAction.call(
              this,
              action,
              targetCollection,
              {
                store,
                triggered,
                prevAction,
                mode,
                strict
              }
            );
            break;

          case 'WorkflowSpecification':
            handledAction = await handleUpdateWorkflowSpecificationAction.call(
              this,
              action,
              targetCollection,
              { store, triggered, prevAction, mode, strict }
            );
            break;

          case 'Graph':
            if (targetCollection.version != null) {
              handledAction = await handleUpdateReleaseAction.call(
                this,
                action,
                targetCollection,
                {
                  store,
                  triggered,
                  prevAction,
                  mode,
                  strict
                }
              );
            } else {
              handledAction = await handleUpdateGraphAction.call(
                this,
                action,
                targetCollection,
                {
                  store,
                  triggered,
                  prevAction,
                  mode,
                  strict
                }
              );
            }
            break;

          case 'PublicationIssue':
            handledAction = await handleUpdatePublicationIssueAction.call(
              this,
              action,
              targetCollection,
              { store, triggered, prevAction, mode, strict }
            );
            break;

          case 'SpecialPublicationIssue':
            handledAction = await handleUpdateSpecialPublicationIssueAction.call(
              this,
              action,
              targetCollection,
              { store, triggered, prevAction, mode, strict }
            );
            break;

          case 'Tag':
          case 'Review':
          case 'Comment':
            throw createError(
              400,
              `UpdateAction support for action ${
                targetCollection['@type']
              } is currently not available`
            );

          default:
            throw createError(
              400,
              `Unsuported target collection (got ${targetCollection['@type']})`
            );
        }
      }
    }
  } catch (err) {
    throw err;
  } finally {
    if (lock) {
      try {
        await lock.unlock();
      } catch (err) {
        this.log.error(
          err,
          'could not unlock release lock, but will auto expire'
        );
      }
    }
  }

  return handledAction;
}
