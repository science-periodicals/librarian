import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, dearrayify, arrayify } from '@scipe/jsonld';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { WEBIFY_ACTION_TYPES } from '../../constants';
import getScopeId from '../../utils/get-scope-id';
import { getResult } from '../../utils/schema-utils';
import { getEmbeddedNodeAndProp } from '../../utils/embed-utils';

/**
 *  This is used to handle cases where the object of an `UpdateAction` is an
 *  `UploadAction`. This happens when we udpate:
 *
 * - asset (all the encodings) of a style (CSS variable)
 * - asset (all the encodings) of resource listed as `logo`, `image`, `audio` or
 *  `video` of a scope
 *
 * The `targetCollection` MUST be an embedder document @id (release, issue etc.)
 */
export default async function handleUpdateAssetAction(
  action, // an UpdateAction whose `object` is an UploadAction
  uploadAction, // the `object` of the `action`
  targetCollection,
  { store, mode } = {}
) {
  const scopeId = getScopeId(targetCollection); // ! scopeId may be different from targetCollectionId (e.g. for issue it will be the journal)

  const encoding = getResult(uploadAction);
  if (uploadAction.actionStatus !== 'CompletedActionStatus' || !encoding) {
    throw createError(
      400,
      `${action['@type']}: try again when UploadAction (${getId(
        uploadAction
      )}) is in CompletedActionStatus and has a defined result property`
    );
  }

  const targetCollectionId = getId(targetCollection);
  if (getId(encoding.isNodeOf) !== targetCollectionId) {
    throw createError(
      400,
      `${
        action['@type']
      }: invalid targetCollection, targetCollection (${targetCollectionId}) is different from the one implied by the UploadAction (${getId(
        encoding.isNodeOf
      )})`
    );
  }

  if (
    action.mergeStrategy &&
    action.mergeStrategy !== 'OverwriteMergeStrategy'
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } invalid mergeStrategy expected OverwriteMergeStrategy got ${
        action.mergeStrategy
      }`
    );
  }

  const resourceId = getId(encoding.encodesCreativeWork);
  const [resource] = getEmbeddedNodeAndProp(resourceId, targetCollection);
  if (!resource) {
    throw createError(
      400,
      `${
        action['@type']
      }: could not find ${resourceId} in ${targetCollectionId}`
    );
  }

  let updatePayload, webifyActionResult;
  // if the result of the upload action was webified, handle that
  const instrumentId = getId(uploadAction.instrument);
  if (instrumentId) {
    try {
      const instrument = await this.get(instrumentId, {
        store,
        acl: false
      });
      if (WEBIFY_ACTION_TYPES.has(instrument['@type'])) {
        const webifyAction = instrument;
        // webifyActionResult is an UpdateAction
        webifyActionResult = await this.get(getId(webifyAction.result), {
          store,
          acl: false
        });
        updatePayload = webifyActionResult.object;
      }
    } catch (err) {
      // noop
    }
  }

  if (!updatePayload) {
    updatePayload = { encoding: uploadAction.result };
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      let updatedResource;
      const savedTargetCollection = await this.update(
        targetCollection,
        targetCollection => {
          const [resource, prop] = getEmbeddedNodeAndProp(
            resourceId,
            targetCollection
          );

          updatedResource = handleOverwriteUpdate(
            resource,
            updatePayload,
            action.targetCollection.hasSelector
          );

          return Object.assign({}, targetCollection, {
            [prop]: dearrayify(
              targetCollection[prop],
              arrayify(targetCollection[prop]).map(r => {
                if (getId(r) === getId(updatedResource)) {
                  return updatedResource;
                }
                return r;
              })
            )
          });
        },
        { store, ifMatch: action.ifMatch }
      );

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            action,
            {
              result: pick(updatedResource, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          targetCollection
        ),
        createId('action', action, scopeId)
      );

      // in case the object was an upload action we need to mark the
      // UpdateAction resulting from the webify action (`webifyActionResult`) as
      // completed as well
      const [savedAction, savedWebifyActionResult] = await this.put(
        [handledAction].concat(
          webifyActionResult
            ? Object.assign({}, webifyActionResult, {
                actionStatus: 'CompletedActionStatus',
                endTime: new Date().toISOString()
              })
            : []
        ),
        {
          store,
          force: true
        }
      );

      return Object.assign({}, savedAction, {
        result: mode === 'document' ? savedTargetCollection : updatedResource
      });
    }

    default: {
      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {},
            action.actionStatus !== 'PotentialActionStatus'
              ? {
                  startTime: new Date().toISOString()
                }
              : undefined,
            action.actionStatus === 'StagedActionStatus'
              ? { stagedTime: new Date().toISOString() }
              : undefined,
            action.actionStatus === 'FailedActionStatus'
              ? {
                  endTime: new Date().toISOString()
                }
              : undefined,
            action
          ),
          targetCollection
        ),
        createId('action', action, scopeId)
      );

      return this.put(handledAction, {
        store,
        force: true
      });
    }
  }
}
