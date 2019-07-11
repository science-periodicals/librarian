import pickBy from 'lodash/pickBy';
import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { AUTHOR_SERVICE_ACTION_TYPES } from '../constants';
import {
  getObjectId,
  getChecksumValue,
  getAgentId,
  getRootPartId
} from '../utils/schema-utils';
import createId from '../create-id';
import Store from '../utils/store';
import setId from '../utils/set-id';
import isArchive from '../utils/is-archive';
import handleParticipants from '../utils/handle-participants';
import getScopeId from '../utils/get-scope-id';
import { getMetaActionParticipants, getVersion } from '../utils/workflow-utils';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { parseRoleIds } from '../utils/role-utils';
import { getEmbeddedNodeAndProp } from '../utils/embed-utils';
import { validateParticipantsRestrictedToAuthorsAndProducers } from '../validators';

/**
 * We can upload:
 * - an encoding for a Graph or TypesettingAction
 * - a logo or style for a Release, Periodical, Organization, Service etc.
 *
 * An upload results in an `UploadAction` whose status will only be
 * `CompletedActionStatus` when the associated webify action (if any) is completed
 *
 * The `result` of the `UploadAction` is an encoding that will have the webify
 * action (if any) listed as its potential action. The webify action @id will also be listed in
 * the `requiresCompletionOf` and `instrument` property of the `UploadAction`.
 *
 * Upload do _not_ result in changes of the Graph or Periodical, the user will
 * have to issue `UpdateAction` later on if they validate the upload
 */
export default async function upload(
  readableDataStream, // a readable stream of the blob
  {
    store = new Store(),
    compress = 'auto',
    webify = true, // send to workers (mostly used for testing)
    isRetrying = false,
    acl = false, // boolean
    update = false, // boolean controlling wether the result of a webify action should be applied automatically or not
    mode = 'node', // needed when `update` is true. Can be `node` or `document` (governs if we return the full document or just the relevant nodes as result of an update action). Mostly relevant for embedded objects like roles. Updating a role can return the updated role or the updating containing document (e.g periodical) containing the updated role
    rpc = false, // if set to true, wait untill the webify action is completed (if any)
    fileFormat = 'application/octet-stream',
    strict = true, // if set to false, the `context` can be a graphId
    context, // @id of an action granting write access to Graph (CreateReleaseAction or TypesettingAction) when upload is related to Graph or @id of a Release, Periodical, Person or Organization etc. (static assets). Note: when strict is false, context can be a graphId instead of a CreateReleaseAction or TypesettingAction. This is typically used for stories
    version, // the version if context is a Graph and upload is for an asset of the latest release
    resource, // optional resourceId for when context is a CreateReleaseAction, required resourceId (node:) otherwise
    creator, // required if `acl` is false (if not will be set to userId). This will become the `agent` of the resulting `UploadAction`
    encodingId, // optional set to UUID if undefined
    name, // optional, the file name,
    uploadActionId, // optional, a UUID for the uploadAction (used for the app-suite so it knows what to track),
    uploadActionObject, // the object of the resulting UploadAction (usefull if the `upload` method is called from the handle-upload-action hander).
    uploadActionParticipant // the participant of the resulting UploadAction (usefull if the `upload` method is called from the handle-upload-action hander). If not specified it will be inferred from the context
  } = {}
) {
  // legacy (when upload is called from API `version` can be separate from
  // context as it comes from a query string, we reunify them here
  if (version && getVersion(context) == null) {
    context = `${context}?version=${version}`;
  }

  // we will mutate uploadActionObject so we create a shallow copy
  uploadActionObject = Object.assign(
    {},
    typeof uploadActionObject === 'string'
      ? { '@id': uploadActionObject }
      : uploadActionObject
  );

  if (
    encodingId &&
    getId(uploadActionObject) &&
    encodingId !== getId(uploadActionObject)
  ) {
    throw createError(
      400,
      `upload: parameter mismatch of uploadActionObject @id and encodingId (${getId(
        uploadActionObject
      )} vs ${encodingId})`
    );
  }

  // Get and set `graph`, `resourceId`, `encodingId` and `creator` in the blob store sense of those parameters
  let graph, resourceId, isBasedOn;

  if (typeof context !== 'string') {
    throw createError(400, 'invalid "context" parameter');
  }
  if (resource && typeof resource !== 'string') {
    throw createError(400, 'invalid "resource" parameter');
  }

  // Upload associated with a Graph are only possible within the context of a qualifying action
  let ctxCreateReleaseActionId; // the @id of a CreateReleaseAction (needed for the `instrumentOf` property of the result of the webify action (an UpdateAction)
  if (context.startsWith('action:')) {
    const action = await this.get(context, {
      acl: false,
      store
    });

    if (
      action['@type'] !== 'CreateReleaseAction' &&
      !AUTHOR_SERVICE_ACTION_TYPES.has(action['@type'])
    ) {
      throw createError(
        403,
        `Invalid upload, upload must be associated with CreateReleaseAction or ${Array.from(
          AUTHOR_SERVICE_ACTION_TYPES
        ).join(', ')}`
      );
    }

    ctxCreateReleaseActionId =
      action['@type'] === 'CreateReleaseAction'
        ? getId(action)
        : getId(action.instrumentOf); // the `instrumentOf` prop of author service action is a CreateReleaseAction

    if (AUTHOR_SERVICE_ACTION_TYPES.has(action['@type'])) {
      isBasedOn = getObjectId(action); // the object of an author service action is an encoding
    }

    if (action.actionStatus === 'CompletedActionStatus') {
      throw createError(403, 'Action was already completed');
    }

    const scopeId = getScopeId(action);
    graph = await this.get(createId('graph', scopeId)['@id'], {
      acl: false,
      store
    });

    if (acl) {
      const check = await this.checkAcl({ acl, docs: graph, store });
      const hasPermission =
        check.isAdmin ||
        check([scopeId, 'AdminPermission']) ||
        check([scopeId, 'WritePermission']);

      if (!hasPermission) {
        throw createError(403, 'forbidden');
      }

      if (!creator) {
        creator = check.userId;
      } else {
        creator =
          findRole(creator, graph, {
            ignoreEndDateOnPublicationOrRejection: true
          }) || creator;
      }

      // validate that creator matches the user (`check.userId`)
      const { userId } = parseRoleIds(creator);
      if (userId !== check.userId) {
        throw createError(
          403,
          `invalid value for upload creator, userId could not be infered or did not match ${check.userId} (got (${userId}))`
        );
      }
    }

    // creator may be a roleId or a user string we try to resolve to a proper role
    // Note: we validate that creator must be a role further downstream
    if (creator) {
      const resolvedAgent = findRole(creator, graph, {
        ignoreEndDateOnPublicationOrRejection: true
      });
      if (resolvedAgent) {
        creator = resolvedAgent;
      }
    }

    if (AUTHOR_SERVICE_ACTION_TYPES.has(action['@type'])) {
      const objectId = getObjectId(action);
      const object = await this.get(objectId, {
        acl: false,
        store
      });
      if (resource && resource !== getId(object.encodesCreativeWork)) {
        throw createError(
          403,
          `Invalid "resource" parameter, if specified "resource" should be ${getId(
            object.encodesCreativeWork
          )}`
        );
      }
      resourceId = createId('node', getId(object.encodesCreativeWork), graph)[
        '@id'
      ];
    } else {
      if (resource) {
        let node;
        // verify that `resource` exists and is part of the graph
        try {
          node = await this.get(resource, {
            acl: false,
            store
          });
        } catch (err) {
          throw createError(
            400,
            `Invalid resource parameter, when specified it must point to an existing resource of ${getId(
              graph
            )}`
          );
        }
        if (getScopeId(node) !== getId(graph)) {
          throw createError(
            400,
            `Invalid resource parameter, when specified it must point to a resource of ${getId(
              graph
            )} (got ${getScopeId(node)})`
          );
        }
      }
      resourceId = createId('node', resource, graph)['@id'];
    }

    uploadActionObject.isNodeOf = getId(graph);
    uploadActionObject.encodesCreativeWork = resourceId;

    encodingId = createId('node', encodingId, graph)['@id'];

    // handle uploadActionParticipant
    if (!uploadActionParticipant) {
      const participants = getMetaActionParticipants(action, {
        addAgent: getAgentId(action.agent) !== getAgentId(creator),
        restrictToAuthorsAndProducers: true
      });
      if (participants.length) {
        uploadActionParticipant = participants;
      }
    }
  } else {
    // Upload an asset: `resource` is required and is either:
    // - an asset resource (node:)
    // - a Graph resource node id (node:) if strict is false and scope is a live Graph

    if (!resource) {
      throw createError(400, 'Missing "resource" parameter');
    }

    // Static assets upload associated with release, journals, issues, org profile etc.
    let scope = await this.get(context, {
      store,
      acl: false
    });

    if (
      getId(scope) &&
      (getId(scope).startsWith('issue:') || getId(scope).startsWith('service:'))
    ) {
      // for issues, the scope is the periodical, for service, it's the organization
      scope = await this.get(getScopeId(scope), {
        store,
        acl: false
      });
    }

    graph = scope; // `graph` is in the blob store sense (linked data graph in quad, not Graph)

    if (resource.startsWith('node:')) {
      // verify that if the resource exists, it is part of the scope
      let node;
      try {
        node = await this.get(resource, {
          acl: false,
          store
        });

        if (node) {
          if (getScopeId(node) !== getScopeId(scope)) {
            throw createError(
              400,
              `Invalid resource parameter, when specified it must point to a resource compatible with scope ${getId(
                scope
              )} (got ${getScopeId(node)})`
            );
          }
        }
      } catch (err) {
        throw err;
      }

      // either an asset or part of the Graph
      if (
        scope['@graph'] &&
        arrayify(scope['@graph']).some(_node => getId(_node) === getId(node))
      ) {
        // resource (CreativeWork) of a graph, only possible if `strict` is `false`
        if (strict) {
          throw createError(
            '400',
            'invalid "resource" or "context" parameter. If "resource" is a nodeId part of a graph (not as asset node), and "context" a graphId, upload must be called with "strict=false" or context must be the @id of a CreateReleaseAction or TypesettingAction'
          );
        }
        resourceId = resource;
      } else {
        // asset
        resourceId = createId('node', resource)['@id'];
      }

      uploadActionObject.isNodeOf = node.isNodeOf;
      uploadActionObject.encodesCreativeWork = resourceId;
    } else {
      throw createError('400', 'invalid "resource" parameter');
    }

    encodingId = createId('node', encodingId, scope)['@id'];

    if (acl) {
      const check = await this.checkAcl({ acl, docs: scope, store });

      let hasScopeAccess;
      if (scope['@type'] === 'Graph' && scope.version == null) {
        hasScopeAccess =
          check([getId(scope), 'AdminPermission']) ||
          check([getId(scope), 'WritePermission']);
      } else if (scope['@type'] === 'Graph' && scope.version != null) {
        // in this case can only upload assets => write access to the journal is enough
        const journalId = getRootPartId(scope);
        if (journalId) {
          hasScopeAccess =
            check([getId(scope), 'AdminPermission']) ||
            check([getId(scope), 'WritePermission']) ||
            check([journalId, 'AdminPermission']) ||
            check([journalId, 'WritePermission']);
        }
      } else {
        hasScopeAccess = check([getId(scope), 'AdminPermission']);
      }

      const hasPermission =
        check.isAdmin || scope['@type'] === 'Person' || hasScopeAccess;

      if (!hasPermission) {
        throw createError(403, `forbidden (${getId(scope)})`);
      }

      if (!creator) {
        creator = check.userId;
      } else {
        creator = await resolveCreator(this, creator, scope, { store });
      }

      // validate that creator matches the user (`check.userId`)
      const { userId } = parseRoleIds(creator);
      if (userId !== check.userId) {
        throw createError(
          403,
          `invalid value for upload creator, userId could not be infered or did not match ${check.userId} (got (${userId}))`
        );
      }
    }

    if (creator) {
      creator = await resolveCreator(this, creator, scope, { store });
    }
  }

  if (!graph || !resourceId || !encodingId || !creator) {
    throw createError(400, 'invalid parameters for upload');
  }

  // userId is required for webify action (PUB/SUB) uses it as namespace
  const { userId, roleId } = parseRoleIds(creator);
  if (!userId) {
    throw createError(
      400,
      `Invalid value for upload creator associated with ${getId(
        graph
      )} no userId could be found`
    );
  }

  // Anything associated with a live graph must be role based (for blinding)
  if (graph['@type'] === 'Graph' && graph.version == null && !roleId) {
    throw createError(
      400,
      `Invalid value for upload creator associated with ${getId(
        graph
      )} no roleId could be found`
    );
  }

  uploadActionObject['@id'] = encodingId;

  // validate participants:
  // for live graph, they must only include authors and producers to
  // guarantee that author visibility is not an issue
  if (
    uploadActionParticipant &&
    graph['@type'] === 'Graph' &&
    graph.version == null
  ) {
    const messages = validateParticipantsRestrictedToAuthorsAndProducers(
      uploadActionParticipant,
      graph
    );
    if (messages.length) {
      throw createError(403, messages.join(' '));
    }
  }

  // Proceed with the upload
  return handleUpload.call(
    this,
    readableDataStream,
    fileFormat,
    context,
    graph,
    resourceId,
    encodingId,
    {
      compress,
      webify,
      isRetrying,
      handledAgent: remapRole(creator, 'agent', { dates: false }),
      name,
      isBasedOn,
      update,
      mode,
      uploadActionId,
      uploadActionObject,
      uploadActionParticipant,
      ctxCreateReleaseActionId,
      rpc
    }
  );
}

async function handleUpload(
  readableDataStream, // a readable stream of the blob
  fileFormat,
  context,
  graph, // in the blob store definition (either a Graph, a Periodical or an Organization)
  resourceId, // in the blob store definition (node:)
  encodingId,
  {
    compress,
    webify,
    isRetrying,
    store,
    handledAgent,
    name,
    isBasedOn,
    update,
    mode,
    uploadActionId,
    uploadActionParticipant,
    uploadActionObject,
    ctxCreateReleaseActionId,
    rpc
  } = {}
) {
  // Lock and start the upload only 1 upload at a time for a given `resourceId`
  const identifier = `${getId(graph)}::${context}::${resourceId}`; // we need context to disambiguate between issue and journal as in case of issue the `graph` (in the blob store sense) will be the journal as well (scope of issue is journal)
  const ttl = 1000 * 60 * 2;
  let lock;
  try {
    lock = await this.createLock(identifier, {
      isLocked: async () => {
        const count = await this.getActiveUploadCountsByIdentifier(identifier);
        return count > 0;
      },
      prefix: 'upload',
      ttl
    });
  } catch (err) {
    throw createError(
      423,
      `An upload for ${resourceId} (context=${context}) is already in progress`
    );
  }

  const intervalId = setInterval(async () => {
    try {
      lock = await lock.extend(ttl);
    } catch (err) {
      this.log.error({ err }, 'could not extend lock');
    }
  }, Math.floor(ttl / 2));

  // TODO give an identifier to the UploadAction so that we can track them for the lock

  // Store UploadAction at begining of upload
  try {
    var uploadAction = await this.put(
      setId(
        handleParticipants(
          pickBy(
            {
              '@type': 'UploadAction',
              agent: handledAgent,
              participant: uploadActionParticipant,
              identifier,
              startTime: new Date().toISOString(),
              actionStatus: 'ActiveActionStatus',
              instrumentOf: context.startsWith('action:') ? context : undefined, // required for typesetting action so that we can associate an UploadAction with a TypesettingAction
              object: uploadActionObject
            },
            x => x !== undefined
          ),
          graph
        ),
        createId('action', uploadActionId, getId(graph))
      ),
      { store, force: true }
    );
  } catch (err) {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error({ err }, 'error unlocking, but will auto expire');
    } finally {
      clearInterval(intervalId);
    }
    throw err;
  }

  const cleanupAndMaybeThrow = async ({ error } = {}) => {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error({ err }, 'error unlocking, but will auto expire');
    } finally {
      clearInterval(intervalId);
    }

    if (error) {
      try {
        await this.deleteBlob({
          graphId: getId(graph),
          resourceId,
          encodingId
        });
      } catch (err) {
        this.log.error({ err }, 'error deleting blob');
      }

      try {
        uploadAction = await this.put(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            uploadAction,
            {
              actionStatus: 'FailedActionStatus',
              error: {
                '@type': 'Error',
                statusCode: error.code,
                description: error.message
              }
            }
          ),
          { store, force: true }
        );
      } catch (err) {
        this.log.error({ err }, 'error writing failed upload action');
      }

      throw error;
    }
  };

  // createBlob will correct the fileFormat if needed
  let encoding;
  try {
    encoding = await this.createBlob(readableDataStream, {
      graphId: getId(graph),
      resourceId,
      encodingId,
      isNodeOf: uploadActionObject.isNodeOf,
      name,
      isBasedOn,
      creator: getId(handledAgent) || getAgentId(handledAgent),
      fileFormat,
      encodesCreativeWork: resourceId,
      compress
    });
  } catch (err) {
    await cleanupAndMaybeThrow({ error: err });
  }

  const type = encoding.fileFormat.split('/')[0].trim(); // we use encoding.fileFormat as it may have been corrected by createBlob
  const cType = encoding.fileFormat.split(';')[0].trim();

  // validate type compatibility
  const resource = await this.get(resourceId, { store, acl: false });
  const embedderDoc = await this.get(resource.isNodeOf, { store, acl: false });
  const [, resourceProp] = getEmbeddedNodeAndProp(getId(resource), embedderDoc);

  if (resource['@type']) {
    switch (resource['@type']) {
      case 'TextBox':
      case 'Table':
      case 'Formula':
        if (cType !== 'text/html') {
          await cleanupAndMaybeThrow({
            error: createError(
              403,
              `upload: invalid fileFormat for "${resourceId}" (${
                resource['@type']
              }) upload expected "text/html" got "${encoding.fileFormat}"`
            )
          });
        }
        break;

      case 'Audio':
        if (type !== 'audio') {
          await cleanupAndMaybeThrow({
            error: createError(
              403,
              `upload: invalid fileFormat for "${resourceId}" (${
                resource['@type']
              }) upload expected "audio/*" got "${encoding.fileFormat}"`
            )
          });
        }
        break;

      case 'Video':
        if (type !== 'video') {
          await cleanupAndMaybeThrow({
            error: createError(
              403,
              `upload: invalid fileFormat for "${resourceId}" (${
                resource['@type']
              }) upload expected "video/*" got "${encoding.fileFormat}"`
            )
          });
        }
        break;

      case 'Image':
        if (type !== 'image') {
          await cleanupAndMaybeThrow({
            error: createError(
              403,
              `upload: invalid fileFormat for "${resourceId}" (${
                resource['@type']
              }) upload expected "image/*" got "${encoding.fileFormat}"`
            )
          });
        }
        break;

      default:
        break;
    }
  }

  // ensure resource blob unicity (needed to have a simpler reconciliation algorithm where we can rely on the checksum)
  // Note this check is disabled on retries as it would fail
  if (graph['@type'] === 'Graph' && !isRetrying) {
    const sha = getChecksumValue(encoding, 'sha256');
    if (sha != null) {
      let count;
      try {
        count = await this.getEncodingCountsByChecksumAndScopeId(
          sha,
          getId(graph)
        );
      } catch (error) {
        await cleanupAndMaybeThrow({ error });
      }

      if (count) {
        await cleanupAndMaybeThrow({
          error: createError(
            403,
            `A blob with the same content (sha-256: ${sha}) already exists in graph ${getId(
              graph
            )}`
          )
        });
      }
    }
  }

  // Create webifyAction (when appropriate) and list them as result of the UploadAction
  let webifyAction, webifyActionType;
  if (webify) {
    if (
      type === 'image' &&
      cType !== 'image/svg+xml' // we don't send SVG to image worker
    ) {
      webifyActionType = 'ImageProcessingAction';
    } else if (type === 'audio' || type === 'video') {
      webifyActionType = 'AudioVideoProcessingAction';
    } else if (
      isArchive(encoding.fileFormat) &&
      getId(resource) === getId(embedderDoc.mainEntity) // we only do document transformation for the main entity
    ) {
      webifyActionType = 'DocumentProcessingAction';
    }

    if (webifyActionType) {
      const webifyActionId = createId('action', null, getId(graph));

      webifyAction = setId(
        pickBy(
          {
            '@type': webifyActionType,
            actionStatus: 'PotentialActionStatus',
            agent: handledAgent,
            participant: uploadActionParticipant, // Note: we use same participants as for UploadAction
            instrumentOf: getId(uploadAction),
            object: encoding,
            autoUpdate: !!update, // if `autoUpdate` is set to true the update action will be executed when the webify action is completed
            // Note: the `object` of the `updateAction` will be set by the worker
            result: pickBy(
              {
                '@id': createId('action', null, getId(graph))['@id'],
                '@type': 'UpdateAction',
                agent: handledAgent,
                participant: uploadActionParticipant,
                mergeStrategy:
                  resourceProp === '@graph'
                    ? 'ReconcileMergeStrategy'
                    : 'OverwriteMergeStrategy',
                instrumentOf: ctxCreateReleaseActionId, // required for graph update action
                resultOf: getId(webifyActionId),
                actionStatus: 'PotentialActionStatus',
                targetCollection:
                  resourceProp === '@graph'
                    ? getId(embedderDoc)
                    : {
                        '@type': 'TargetRole',
                        targetCollection: getId(embedderDoc),
                        hasSelector: {
                          '@type': 'NodeSelector',
                          node: getId(resource),
                          selectedProperty: resourceProp
                        }
                      }
              },
              x => x !== undefined
            )
          },
          x => x !== undefined
        ),
        webifyActionId
      );
    }
  }

  // save finished upload action (if the upload was not canceled in the meantime)
  let savedUploadAction;
  try {
    savedUploadAction = await this.update(
      uploadAction,
      uploadAction => {
        if (uploadAction.actionStatus === 'CanceledActionStatus') {
          const err = createError(409, 'UploadAction was canceled');
          err.canceledAction = uploadAction;
          throw err;
        }

        return pickBy(
          Object.assign({}, uploadAction, {
            endTime: webifyAction ? undefined : new Date().toISOString(),
            completeOn: webifyAction ? 'OnWorkerEnd' : undefined,
            requiresCompletionOf: webifyAction
              ? getId(webifyAction)
              : undefined,
            actionStatus: webifyAction
              ? 'ActiveActionStatus'
              : 'CompletedActionStatus',
            instrument: webifyAction ? getId(webifyAction) : undefined,
            // we embed result for convenience
            result: webifyAction
              ? Object.assign({}, encoding, {
                  potentialAction: getId(webifyAction)
                })
              : encoding
          }),
          x => x !== undefined
        );
      },
      {
        store
      }
    );
  } catch (err) {
    if (err.canceledAction) {
      await cleanupAndMaybeThrow();
      return err.canceledAction;
    } else {
      await cleanupAndMaybeThrow({ error: err });
    }
  }

  if (webifyActionType) {
    try {
      webifyAction = await this.post(webifyAction, {
        acl: false,
        rpc,
        isRetrying,
        fromAction: savedUploadAction,
        store
      });
      encoding.potentialAction = webifyAction;
    } catch (error) {
      await cleanupAndMaybeThrow({ error });
    }
  } else {
    if (update) {
      let updateAction = pickBy(
        {
          '@id': createId('action', null, getId(graph))['@id'],
          '@type': 'UpdateAction',
          agent: handledAgent,
          participant: uploadActionParticipant,
          mergeStrategy:
            resourceProp === '@graph'
              ? 'ReconcileMergeStrategy'
              : 'OverwriteMergeStrategy',
          instrumentOf: ctxCreateReleaseActionId, // required for graph update action
          actionStatus: 'CompletedActionStatus',
          object: getId(savedUploadAction),
          targetCollection: uploadActionObject.isNodeOf // with an UploadAction as object, the targetCollection is always the embedderDocId
        },
        x => x !== undefined
      );

      try {
        updateAction = await this.post(updateAction, {
          acl: false,
          fromAction: savedUploadAction,
          mode,
          store
        });
      } catch (error) {
        Object.assign(updateAction, {
          actionStatus: 'FailedActionStatus',
          error: {
            '@type': 'Error',
            statusCode: 500,
            description: error.message
          }
        });
        this.log.error(
          { savedUploadAction, updateAction, err: error },
          'Error in upload with autoUpdate'
        );
      }

      savedUploadAction.potentialAction = updateAction;
    }
  }

  await cleanupAndMaybeThrow();

  return Object.assign({}, savedUploadAction, { result: encoding });
}

async function resolveCreator(librarian, creator, scope, { store } = {}) {
  if (!creator) return creator;

  let unversionedScope;
  if (scope['@type'] === 'Graph' && scope.version !== null) {
    unversionedScope = await librarian.get(getScopeId(getId(scope)), {
      acl: false,
      store
    });
  } else {
    unversionedScope = scope;
  }

  let resolvedAgent = findRole(creator, unversionedScope, {
    ignoreEndDateOnPublicationOrRejection: true
  });

  // in case of releases, a journal role can upload style (banners etc.)
  // => we also try to resolve `creator` from the journal
  if (!resolvedAgent && scope['@type'] === 'Graph' && scope.version != null) {
    const journalId = getRootPartId(scope);
    if (journalId) {
      const journal = await librarian.get(journalId, {
        store,
        acl: false
      });
      resolvedAgent = findRole(creator, journal, {
        ignoreEndDateOnPublicationOrRejection: true
      });
    }
  }

  if (resolvedAgent) {
    creator = resolvedAgent;
  }

  return creator;
}
