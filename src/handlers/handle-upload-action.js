import fs from 'fs';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import ds3Mime from '@scipe/ds3-mime';
import { getObject } from '../utils/schema-utils';

export default async function handleUploadAction(
  action,
  {
    store,
    acl,
    mode = 'node',
    triggered,
    prevAction,
    strict,
    isRetrying,
    webify, // send to workers (mostly used for testing)
    rpc = false // if set to true, wait untill the webify action is completed (if any)
  } = {}
) {
  if (triggered) {
    // Typical case: user called this.upload() that dispatched a webify action, when the webify action completes, this handler is triggered
    // TODO get Graph and call handleParticipants again in case new participants were added
    const handledAction = Object.assign(
      {},
      action.actionStatus !== 'PotentialActionStatus'
        ? {
            startTime: new Date().toISOString()
          }
        : undefined,
      action.actionStatus === 'StagedActionStatus'
        ? { stagedTime: new Date().toISOString() }
        : undefined,
      action.actionStatus === 'CompletedActionStatus' ||
        action.actionStatus === 'CanceledActionStatus' ||
        action.actionStatus === 'FailedActionStatus'
        ? {
            endTime: new Date().toISOString()
          }
        : undefined,
      action
    );

    const savedAction = await this.put(handledAction, {
      force: true,
      store
    });

    return savedAction;
  }

  // non triggered case, user need to POST an action in ActiveActionStatus
  // The posted action should have a file:// contentUrl that we turn into
  // a readable stream that we sent to the `upload` method
  // Note: Cancelling and action is done through issuing a CancelAction.
  if (action.actionStatus !== 'ActiveActionStatus') {
    let msg = `${action['@type']} actionStatus must be ActiveActionStatus`;
    if (action.actionStatus === 'CanceledActionStatus') {
      msg += ` Use a CancelAction to cancel the UploadAction`;
    }

    throw createError(400, msg);
  }

  // get the parameters needed for the `upload` method
  // object should be a MediaObject with:
  // - a file:// contentUrl
  // - a isNodeOf prop
  // - a encodesCreativeWork prop (with @id and optionally isNodeOf)

  // get the `resource` and `context` params
  let resource, context;
  const object = getObject(action);
  if (!object) {
    throw createError(400, `${action['@type']} object must be defined`);
  }

  if (object.encodesCreativeWork) {
    resource = getId(object.encodesCreativeWork);
    // instrumentOf can be a CreateReleaseAction or a Typesetting action
    const instrumentOfId = getId(action.instrumentOf);
    context =
      instrumentOfId && instrumentOfId.startsWith('action:')
        ? instrumentOfId
        : getId(object.isNodeOf) || getId(object.encodesCreativeWork.isNodeOf);
  }

  if (!resource || !context) {
    throw createError(
      400,
      `${
        action['@type']
      } invalid object (resource: ${resource}, context: ${context})`
    );
  }

  // validate the contentUrl prop
  const contentUrl = object.contentUrl;
  if (
    !contentUrl ||
    typeof contentUrl !== 'string' ||
    !contentUrl.startsWith('file:///')
  ) {
    throw createError(
      400,
      `${action['@type']} invalid object, missing file:/// contentUrl`
    );
  }

  // validate fileFormat. We require a fileFormat for UploadAction
  const { fileFormat, name: fileName } = object;
  if (!fileFormat) {
    throw createError(
      400,
      `${
        action['@type']
      } invalid object, missing fileFormat. fileFormat must be a valid MIME`
    );
  }
  if (fileName && fileName.endsWith('.ds3.docx') && fileFormat !== ds3Mime) {
    throw createError(
      400,
      `${
        action['@type']
      } invalid object, incompatible fileFormat and file name (${fileName}, ${fileFormat})`
    );
  }

  const handledUploadAction = await this.upload(
    fs.createReadStream(object.contentUrl.replace(/^file:\/\//, '')),
    {
      acl,
      creator: action.agent, // `creator` will be validated by `this.upload` so we don't do anything here
      webify,
      isRetrying,
      context,
      resource,
      name: object.name,
      fileFormat,
      type: object['@type'],
      uploadActionId: getId(action),
      uploadActionObject: object,
      uploadActionParticipant: action.participant, // Note: if undefined, `this.upload` will set the right participant based on context. This will be validated by `upload` so we don't do any validation here
      encodingId: getId(object),
      update: !!action.autoUpdate,
      mode,
      strict,
      rpc
    }
  );

  return handledUploadAction;
}
