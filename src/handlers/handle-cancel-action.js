import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { isActionAssigned } from '../acl';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import getScopeId from '../utils/get-scope-id';
import setId from '../utils/set-id';
import createId from '../create-id';
import { getObjectId } from '../utils/schema-utils';
import { WEBIFY_ACTION_TYPES } from '../constants';

export default async function handleCancelAction(
  action,
  { store, triggered, prevAction, strict } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be a defined`);
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });

  const scopeId = getScopeId(object);

  // we grab the graph
  const scope = await this.get(scopeId, {
    store,
    acl: false
  });

  const sourceAgent = findRole(action.agent, scope, {
    ignoreEndDateOnPublicationOrRejection: true
  });

  if (!sourceAgent) {
    throw createError(
      400,
      `Invalid agent, agent could not be found in the ${scope['@type']} ${getId(
        scope
      )}`
    );
  }

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(sourceAgent, 'agent', { dates: false }),
          result: getId(object)
        }
      ),
      scope
    ),
    createId('action', action, scope)
  );

  if (
    object.actionStatus === 'CompletedActionStatus' ||
    object.actionStatus === 'FailedActionStatus'
  ) {
    // Note: we will do the same check when calling this.update
    throw createError(
      400,
      `${object['@type']} in  ${object.actionStatus} cannot be canceled`
    );
  } else if (object.actionStatus === 'CanceledActionStatus') {
    // No op
    return Object.assign({}, handledAction, { result: object });
  }

  switch (object['@type']) {
    // Note: we also cancel the EndorseAction potential action of the canceled action

    // polyton actions (cannot cancel beyond `minInstances`)
    case 'ReviewAction': {
      if (isActionAssigned(object)) {
        throw createError(
          403,
          `Cannot cancel ${action['@type']} ${action['@id']}. Only unassigned ${
            action['@type']
          } can be canceled`
        );
      }
      const stageId = getId(object.resultOf);
      const templateId = getId(object.instanceOf);

      const maxInstances = object.maxInstances || 1;
      const minInstances = object.minInstances || 0;
      // Note: there is a global lock on the workflow action (see
      // `librarian#createWorkflowActionLock`) so the read is safe (nothing can
      // change while the lock is on)
      const polytonActions = await this.getActionsByStageIdAndTemplateId(
        stageId,
        templateId,
        { store }
      );

      if (polytonActions.length !== maxInstances) {
        throw createError(
          503,
          `All the documents required to handle ${action['@type']} (${
            polytonActions.length
          } !== ${maxInstances}) haven't been replicated to the server yet, please try again later`
        );
      }

      const nonCanceledActions = arrayify(polytonActions).filter(
        action => action.actionStatus !== 'CanceledActionStatus'
      );

      if (nonCanceledActions.length <= minInstances) {
        throw createError(
          403,
          `Cannot cancel ${getId(object)} (${object['@type']}) ${
            nonCanceledActions.length
          } non cancelled action (minInstances ${minInstances}, maxInstances ${maxInstances}) }`
        );
      }

      const updatedObject = await this.update(
        object,
        object => {
          if (
            object.actionStatus === 'CompletedActionStatus' ||
            object.actionStatus === 'FailedActionStatus'
          ) {
            throw createError(
              400,
              `{object['@type']} in  ${object.actionStatus} cannot be canceled`
            );
          }

          return handleUserReferences(
            handleParticipants(
              Object.assign(
                {
                  endTime: new Date().toISOString()
                },
                object,
                {
                  actionStatus: 'CanceledActionStatus'
                }
              ),
              scope
            ),
            scope
          );
        },
        { store }
      );

      // Cancel associated EndorseAction
      const endorseActions = await this.getActionsByObjectIdAndType(
        getId(object),
        'EndorseAction',
        { store }
      );

      const updatedEndorseActions = await Promise.all(
        endorseActions.map(endorseAction => {
          return this.update(
            endorseAction,
            endorseAction => {
              return Object.assign(
                {
                  endTime: new Date().toISOString()
                },
                endorseAction,
                {
                  actionStatus: 'CanceledActionStatus'
                }
              );
            },
            { store }
          );
        })
      );

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      try {
        await this.syncGraph(
          scope,
          [savedAction, updatedObject, ...updatedEndorseActions],
          { store }
        );
      } catch (err) {
        this.log.error({ err, action: savedAction }, 'error syncing graphs');
      }

      try {
        await this.syncWorkflow(
          [savedAction, updatedObject, ...updatedEndorseActions],
          { store }
        );
      } catch (err) {
        this.log.error(
          { err, action: savedAction },
          'error syncing workflowStage'
        );
      }

      return Object.assign({}, savedAction, { result: updatedObject });
    }

    case 'UploadAction': {
      const updatedObject = await this.update(
        object,
        object => {
          if (
            object.actionStatus === 'CompletedActionStatus' ||
            object.actionStatus === 'FailedActionStatus'
          ) {
            throw createError(
              400,
              `{object['@type']} in  ${object.actionStatus} cannot be canceled`
            );
          }
          return Object.assign(
            {
              endTime: new Date().toISOString()
            },
            object,
            {
              actionStatus: 'CanceledActionStatus'
            }
          );
        },
        { store }
      );

      // We also cancel the webify action if there is one
      const webifyActionId = getId(updatedObject.instrument);
      if (webifyActionId) {
        let webifyAction;
        try {
          webifyAction = await this.get(webifyActionId, {
            acl: false,
            store
          });
        } catch (err) {
          // noop
        }

        if (webifyAction && WEBIFY_ACTION_TYPES.has(webifyAction['@type'])) {
          try {
            await this.post(
              {
                '@type': 'CancelAction',
                agent: action.agent,
                actionStatus: 'CompletedActionStatus',
                object: getId(webifyAction)
              },
              { acl: false, store, strict }
            );
          } catch (err) {
            this.log.error(
              { err, action, webifyAction },
              'error cancelling webify action while cancelling UploadAction'
            );
            // noop
          }
        }
      }

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      return Object.assign({}, savedAction, { result: updatedObject });
    }

    case 'DocumentProcessingAction':
    case 'ImageProcessingAction':
    case 'AudioVideoProcessingAction': {
      try {
        await this.publish(action);
      } catch (err) {
        throw err;
      }
      const updatedObject = await this.update(
        object,
        object => {
          if (
            object.actionStatus === 'CompletedActionStatus' ||
            object.actionStatus === 'FailedActionStatus' ||
            object.actionStatus === 'CanceledActionStatus'
          ) {
            throw createError(
              400,
              `{object['@type']} in  ${object.actionStatus} cannot be canceled`
            );
          }
          return Object.assign(
            {
              endTime: new Date().toISOString()
            },
            object,
            {
              actionStatus: 'CanceledActionStatus'
            }
          );
        },
        { store }
      );

      // we also cancel the upstream upload action (if there is one)
      const instrumentOfId = getId(updatedObject.instrumentOf);
      if (instrumentOfId) {
        const uploadAction = await this.get(instrumentOfId, {
          acl: false,
          store
        });

        if (uploadAction && uploadAction['@type'] === 'UploadAction') {
          try {
            await this.post(
              {
                '@type': 'CancelAction',
                agent: action.agent,
                actionStatus: 'CompletedActionStatus',
                object: getId(uploadAction)
              },
              { acl: false, store, strict }
            );
          } catch (err) {
            this.log.error(
              { err, action, uploadAction },
              'error cancelling uploadAction action while cancelling webify action'
            );
            // noop
          }
        }
      }

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      return Object.assign({}, savedAction, { result: updatedObject });
    }

    default:
      throw createError(400, `invalid object for ${action['@type']}`);
  }
}
