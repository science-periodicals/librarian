import { getId, unrole } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import schema from '../utils/schema';
import getScopeId from '../utils/get-scope-id';
import { getObjectId } from '../utils/schema-utils';
import {
  getMetaActionParticipants,
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * TypesettingAction is a service action and must have been created through a BuyAction
 * - The object of a TypesettingAction must be an encoding
 * - The result of a TypesettingAction must be a _completed_ UploadAction.
 *
 * Note: TypesettingAction.comment can have `RevisionRequestComment` (`action.comment`)
 * used to allow  the typesetter to ask revision to authors (e.g if the PDF (`object`)
 * lack information.
 * `RevisionRequestComment` have an `ifMatch` prop pointing to the sha256 of the encoding
 * present at the time the comment was created
 * The `object` has a `supersedes` prop embedding the replaced object so we can infer
 * to which `RevisionRequestComment` the `object` is a response to
 *
 * See also: handleUpdateGraphAction for side effect where we update the `object` of
 * the TypesettingAction in response to author uploads
 */
export default async function handleTypesettingAction(
  action,
  { store, triggered, prevAction, sideEffects = true } = {},
  callback
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      'Invalid object: object must point to a valid encoding @id.'
    );
  }

  const encoding = await this.get(objectId, {
    acl: false,
    store
  });

  if (!encoding || !schema.is(encoding, 'MediaObject')) {
    throw createError(
      400,
      'Invalid TypesettingAction: object must point to a valid encoding id'
    );
  }

  const scopeId = getScopeId(encoding);
  const graphId = createId('graph', scopeId)['@id'];

  const graph = await this.get(graphId, {
    acl: false,
    store
  });

  // Note: `ensureServiceCompliance` ensures that the comment in `action.comment` (if any) have an @id
  action = await this.ensureServiceCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  let handledAction, payloadOverwrite;
  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const resultId = getId(unrole(action.result, 'result'));
      if (!resultId) {
        throw createError(
          400,
          `${getId(action)} (${
            action['@type']
          }) Invalid result: result must point to a completed upload action @id (got ${resultId}).`
        );
      }

      let uploadAction;
      try {
        uploadAction = await this.get(resultId, {
          acl: false,
          store
        });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }

      if (!uploadAction) {
        throw createError(
          400,
          `${getId(action)} (${action['@type']}) result ${getId(
            uploadAction
          )} (UploadAction) could not be found`
        );
      } else if (uploadAction.actionStatus !== 'CompletedActionStatus') {
        throw createError(
          423,
          `${getId(action)} (${action['@type']}) result ${getId(
            uploadAction
          )} (UploadAction) must be in CompletedActionStatus (got ${
            uploadAction.actionStatus
          })`
        );
      } else if (
        // result of the UploadAction must be based on the encoding object of the typesetting action
        !unrole(uploadAction.result, 'result') ||
        getId(unrole(uploadAction.result, 'result').isBasedOn) !==
          getId(encoding)
      ) {
        throw createError(
          400,
          `${getId(action)} (${action['@type']}) result ${getId(
            uploadAction
          )} (UploadAction) must result in an encoding based on the object of the TypesettingAction (${objectId})`
        );
      }

      const now = action.endTime || new Date().toISOString();
      handledAction = handleParticipants(
        Object.assign(
          {
            startTime: now,
            endTime: now
          },
          action,
          { result: getId(uploadAction) }
        ),
        graph,
        now
      );

      if (!sideEffects) {
        return handledAction;
      }

      // if `autoUpdate` is set to `true` we update the graph with the result of the TS action
      if (action.autoUpdate) {
        let updateAction = {
          '@type': 'UpdateAction',
          agent: handledAction.agent,
          participant: getMetaActionParticipants(action, {
            addAgent: true
          }),
          object: getId(uploadAction),
          instrumentOf: getId(action.instrumentOf), // the create release action granting upload perm to the `Graph`
          actionStatus: 'CompletedActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          targetCollection: scopeId
        };

        try {
          updateAction = await this.post(updateAction, { acl: false, store });
        } catch (err) {
          Object.assign(updateAction, {
            actionStatus: 'FailedActionStatus',
            error: {
              '@type': 'Error',
              statusCode: 500,
              description: err.message
            }
          });
          this.log.error(
            { action, updateAction, err },
            'Error in handle-typesetting-action with autoUpdate'
          );
        }
        uploadAction.potentialAction = updateAction;
      }

      payloadOverwrite = { result: uploadAction };
      break;
    }

    default: {
      const now = getActionStatusTime(action) || new Date().toISOString();

      handledAction = handleParticipants(
        setDefaultActionStatusTime(action, now),
        graph,
        now
      );

      if (!sideEffects) {
        return handledAction;
      }

      break;
    }
  }

  const savedAction = await this.put(handledAction, {
    store,
    force: true
  });

  try {
    await this.syncGraph(graph, savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing graphs');
  }

  try {
    await this.syncWorkflow(savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing workflowStage');
  }

  return Object.assign({}, savedAction, payloadOverwrite);
}
