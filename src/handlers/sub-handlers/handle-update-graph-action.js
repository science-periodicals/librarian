import omit from 'lodash/omit';
import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import {
  getId,
  flatten,
  arrayify,
  dearrayify,
  purge,
  getNodeMap
} from '@scipe/jsonld';
import { updateNode, handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import {
  validateOverwriteUpdate,
  validateStylesAndAssets,
  validateGraphNodes,
  validateParticipantsRestrictedToAuthorsAndProducers
} from '../../validators';
import { WEBIFY_ACTION_TYPES, PDF } from '../../constants';
import schema from '../../utils/schema';
import { getObjectId, getResult, getObject } from '../../utils/schema-utils';
import getScopeId from '../../utils/get-scope-id';
import { setEmbeddedIds } from '../../utils/embed-utils';
import findRole from '../../utils/find-role';
import remapRole from '../../utils/remap-role';

/**
 * !! style and asset updates when `object` is an `UploadAction` are handled
 * with `handleUpdateAssetAction` upstream. Here we only handle `UploadAction`
 * targeting a resource of the `@graph`
 *
 * Note: we never delete the blobs as they could be needed in a previous release
 * side effects:
 * - we may need to update the `object` (encoding) of a TypesettingAction
 * - we may need to create / delete `CheckAction` so that author and contributor can confirm their participations
 */
export default async function handleUpdateGraphAction(
  action,
  graph,
  { store, triggered, prevAction, mode, strict }
) {
  // validate agent (must be graph role)
  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  // For Graphs, the agent must be a Role (so that we can preserve anonymity)
  if (!sourceAgent) {
    throw createError(
      400,
      `${action['@type']} agent must be a valid Graph (${getId(graph)}) Role`
    );
  }
  const handledAgent = remapRole(sourceAgent, 'agent', { dates: false });

  // validate participants:
  // for live graph, they must only include authors and producers to
  // guarantee that author visibility is not an issue
  if (action.participant) {
    const messages = validateParticipantsRestrictedToAuthorsAndProducers(
      action.participant,
      graph
    );
    if (messages.length) {
      throw createError(403, messages.join(' '));
    }
  }

  // `action` must have an `instrumentOf` property pointing to an _active_ CreateReleaseAction
  const instrumentOfId = getId(action.instrumentOf);
  if (!instrumentOfId) {
    throw createError(
      400,
      `invalid ${action['@type']}, ${
        action['@type']
      } targetting a Graph must have an instrumentOf property pointing to an active or staged CreateReleaseAction`
    );
  }

  const createReleaseAction = await this.get(instrumentOfId, {
    acl: false,
    store
  });

  if (
    !createReleaseAction ||
    createReleaseAction['@type'] !== 'CreateReleaseAction' ||
    !(
      createReleaseAction.actionStatus === 'ActiveActionStatus' ||
      createReleaseAction.actionStatus === 'StagedActionStatus'
    ) ||
    getScopeId(createReleaseAction) !== getScopeId(graph)
  ) {
    throw createError(
      400,
      `invalid ${action['@type']}, ${
        action['@type']
      } targetting a Graph must have an instrumentOf property pointing to an active or staged CreateReleaseAction related to the graph ${getId(
        graph
      )} (got ${createReleaseAction['@type']}, ${
        createReleaseAction.actionStatus
      }, ${getObjectId(createReleaseAction)})`
    );
  }

  action = await this.validateAndSetupNodeIds(action, {
    store,
    strict,
    prevEmbedderDoc: graph
  });

  // grab upload action (if any)
  let uploadAction;
  if (getId(action.object) && getId(action.object).startsWith('action:')) {
    let object;
    try {
      object = await this.get(getId(action.object), {
        store,
        acl: false
      });
    } catch (err) {
      // noop
    }

    if (object && object['@type'] === 'UploadAction') {
      uploadAction = object;
      if (uploadAction.actionStatus !== 'CompletedActionStatus') {
        throw createError(
          400,
          'Try again when UploadAction is in CompletedActionStatus'
        );
      }
    }
  }

  if (!uploadAction) {
    const messages = validateOverwriteUpdate(
      graph,
      action.object,
      action.targetCollection.hasSelector,
      {
        immutableProps: [
          '_id',
          '@id',
          '_rev',
          '@type',
          'encryptionKey',
          'potentialAction',
          'hasDigitalDocumentPermission',
          'datePublished',
          'dateCreated',
          'version',
          'creator',
          'reviewer',
          'author',
          'contributor',
          'editor',
          'producer'
        ]
      }
    );

    if (messages.length) {
      throw createError(400, messages.join(' '));
    }
  }

  const { mergeStrategy } = action;
  if (mergeStrategy === 'ReconcileMergeStrategy') {
    // with `ReconcileMergeStrategy` targetCollection cannot be a selector but
    // must be the graphId
    if (getId(action.targetCollection) !== getId(graph)) {
      throw createError(
        403,
        `${
          action['@type']
        } with ${mergeStrategy} targetCollection cannot be a selector or a node and must be the graph @id (${getId(
          graph
        )})`
      );
    }

    // UploadAction must targeting a resource of the graph
    if (uploadAction) {
      const targetResourceId = getId(
        getResult(uploadAction).encodesCreativeWork
      );

      // `targetResourceId` must be in the `@graph`
      if (
        !arrayify(graph['@graph']).some(
          node => getId(node) === targetResourceId
        )
      ) {
        throw createError(
          403,
          `${action['@type']} the ${
            uploadAction['@type']
          } target resource (${targetResourceId}) cannot be found in the @graph of ${getId(
            graph
          )}`
        );
      }
    }
  } else if (mergeStrategy === 'OverwriteMergeStrategy') {
    // No upload action are possible in this mode
    if (uploadAction) {
      throw createError(
        403,
        `${action['@type']} with ${mergeStrategy} object cannot be an ${
          uploadAction['@type']
        }`
      );
    }

    // if @graph is updated, we can't have a selector
    if (
      action.object['@graph'] &&
      getId(action.targetCollection) !== getId(graph)
    ) {
      throw createError(
        403,
        `${
          action['@type']
        } with ${mergeStrategy}, if object updates the @graph, targetCollection cannot be a selector and must be the graph @id (${getId(
          graph
        )})`
      );
    }
  } else {
    throw createError(
      400,
      `${
        action['@type']
      } invalid mergeStrategy: mergeStrategy must be specified whith a value of ReconcileMergeStrategy or OverwriteMergeStrategy`
    );
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      let savedGraph;
      if (mergeStrategy === 'ReconcileMergeStrategy') {
        savedGraph = await reconcileUpdate.call(this, action, graph, {
          store,
          uploadAction
        });
      } else {
        // OverwriteMergeStrategy
        savedGraph = await overwriteUpdate.call(this, action, graph, {
          store
        });
      }

      // SIDE EFFECT:
      // in case where an active TypesettingAction is associated with the graph,
      // we may need to update it's object
      if (getId(graph.mainEntity)) {
        const nodeMap = getNodeMap(graph);
        const mainEntity = nodeMap[getId(graph.mainEntity)];
        if (mainEntity) {
          const encodingId = arrayify(mainEntity.encoding).find(encodingId => {
            const encoding = nodeMap[getId(encodingId)];
            return encoding && encoding.fileFormat === PDF;
          });

          const typesettingActions = await this.getActionsByObjectIdAndType(
            encodingId,
            'TypesettingAction',
            {
              store
            }
          );

          const typesettingAction = typesettingActions.find(
            action =>
              action.actionStatus === 'PotentialActionStatus' ||
              action.actionStatus === 'ActiveActionStatus' ||
              action.actionStatus === 'StagedActionStatus'
          );

          if (typesettingAction) {
            const nextNodeMap = getNodeMap(savedGraph);
            const nextMainEntity = nextNodeMap[getId(savedGraph.mainEntity)];

            if (nextMainEntity) {
              let updatedEncoding = arrayify(nextMainEntity.encoding)
                .map(encodingId => nextNodeMap[getId(encodingId)])
                .find(encoding => encoding && encoding.fileFormat === PDF);

              if (updatedEncoding) {
                updatedEncoding = Object.assign(
                  {},
                  updatedEncoding,
                  {
                    // We link to the previous encoding with the `supersedes` prop:
                    // this is needed to be able to associate to which
                    // `RevisionRequestComment` (stored in TypesettingAction.comment) the
                    // upload was in response to. !!
                    // The contentChecksum needs to be present
                    supersedes: getObject(typesettingAction) // taking the `object` ensure that a full chain of supersedes is built (all the way to the first encoding)
                  },
                  updatedEncoding.contentChecksum
                    ? {
                        contentChecksum: dearrayify(
                          updatedEncoding.contentChecksum,
                          arrayify(updatedEncoding.contentChecksum).map(
                            contentChecksumId => {
                              const contentChecksum =
                                nextNodeMap[getId(contentChecksumId)];
                              return contentChecksum || contentChecksumId;
                            }
                          )
                        )
                      }
                    : undefined
                );

                const updatedTypesettingAction = await this.update(
                  typesettingAction,
                  action => {
                    return Object.assign({}, action, {
                      object: updatedEncoding
                    });
                  },
                  { store }
                );

                try {
                  await this.syncWorkflow(updatedTypesettingAction, { store });
                } catch (err) {
                  this.log.error(
                    { err, action: updatedTypesettingAction },
                    'error syncing workflowStage'
                  );
                }
              }
            }
          }
        }
      }

      const updatedTime = new Date().toISOString();
      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: updatedTime
            },
            action,
            {
              agent: handledAgent,
              result: pick(savedGraph, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          savedGraph
        ),
        createId('action', getId(action), getId(graph))
      );

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      if (
        createReleaseAction.releaseRequirement ===
        'ProductionReleaseRequirement'
      ) {
        // issue CheckActions
        await this.syncCheckActions(savedGraph, {
          store,
          now: updatedTime
        });
      }

      return Object.assign({}, savedAction, {
        result: omit(savedGraph, ['@lucene'])
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
            action,
            {
              agent: handledAgent
            }
          ),
          graph
        ),
        createId('action', getId(action), getId(graph))
      );

      return this.put(handledAction, {
        store,
        force: true
      });
    }
  }
}

async function overwriteUpdate(action, graph, { store } = {}) {
  const savedGraph = await this.update(
    graph,
    async graph => {
      let nextGraph = handleOverwriteUpdate(
        graph,
        action.object,
        action.targetCollection.hasSelector
      );

      const updatedProps =
        action.targetCollection &&
        action.targetCollection.hasSelector &&
        action.targetCollection.hasSelector.selectedProperty
          ? [action.targetCollection.hasSelector.selectedProperty]
          : Object.keys(action.object);

      if (updatedProps.includes['@graph'] && nextGraph['@graph']) {
        const flattened = await flatten(
          { '@graph': nextGraph['@graph'] },
          { preserveUuidBlankNodes: true }
        );
        nextGraph['@graph'] = flattened['@graph'];
      }

      nextGraph = setEmbeddedIds(nextGraph);

      const messages = validateStylesAndAssets(nextGraph).concat(
        validateGraphNodes(nextGraph)
      );
      if (messages.length) {
        throw createError(400, messages.join(' ; '));
      }

      return nextGraph;
    },
    { store, ifMatch: action.ifMatch }
  );

  return savedGraph;
}

async function reconcileUpdate(action, graph, { store, uploadAction } = {}) {
  let updatePayload, upsertedResourceId, webifyAction, webifyActionResult;

  // object can be an update payload or a Completed UploadAction.
  // Handle case when object is an UploadAction
  // !! we do _not_ unrole as the update payload can be anything
  if (uploadAction) {
    if (uploadAction.result) {
      upsertedResourceId = getId(getResult(uploadAction).encodesCreativeWork);
    }

    // Note: this will be overwritten if there is a webify action
    if (!upsertedResourceId) {
      throw createError(
        400,
        'handleReconcileUpdate upsertedResourceId is undefined'
      );
    }

    updatePayload = {
      '@graph': [
        {
          '@id': upsertedResourceId,
          [schema.is(uploadAction.result, 'DataDownload')
            ? 'distribution'
            : 'encoding']: uploadAction.result
        }
      ]
    };

    // We overwrite updatePayload to the result of an associated webify action (if any)
    const instrumentId = getId(uploadAction.instrument);
    if (instrumentId) {
      try {
        const instrument = await this.get(instrumentId, {
          store,
          acl: false
        });
        if (WEBIFY_ACTION_TYPES.has(instrument['@type'])) {
          webifyAction = instrument;
          // the result of the webifyAction (`webifyActionResult` is an UpdateAction)
          webifyActionResult = await this.get(getId(webifyAction.result), {
            store,
            acl: false
          });
          updatePayload = webifyActionResult.object;
        }
      } catch (err) {
        if (err.code === 404) {
          // noop
        }
        throw err;
        // noop
      }
    }
  } else {
    // Handle case when object is an update payload
    updatePayload = action.object; // !we do _not_ unrole as the update payload can be anything

    // the update payload may result from a webify action
    // !! given that librarian.post is called within the worker _before_
    // saving the competed webify action, we don't check that the webifyaction
    // is completed and just used it to get the upsertedResourceId
    if (action.resultOf) {
      try {
        const resultOf = await this.get(action.resultOf, {
          store,
          acl: false
        });
        if (WEBIFY_ACTION_TYPES.has(resultOf['@type'])) {
          webifyAction = resultOf;
          upsertedResourceId = getId(
            getObject(webifyAction).encodesCreativeWork
          );
        }
      } catch (err) {
        // noop
      }
    }
  }

  // ---
  const savedGraph = await this.update(
    graph,
    async graph => {
      // update nodes
      let nextNodes;
      if (updatePayload['@graph']) {
        // first flatten update payload
        const flattened = await flatten(
          { '@graph': updatePayload['@graph'] },
          { sameAs: true, preserveUuidBlankNodes: true }
        );

        const nodeMap = getNodeMap(graph);
        const updNodes = arrayify(flattened['@graph']);

        // The reconciliation:
        // - if `upsertedResourceId` is the main entity, we fully replace the nodes
        // - otherwise we merge the 2 graphs, overwriting the overlapping ones
        if (
          upsertedResourceId &&
          upsertedResourceId === getId(graph.mainEntity)
        ) {
          const updMap = getNodeMap(updNodes);
          nextNodes = updNodes.concat(
            // we add the nodes not overlapping to be sure that all the
            // referenced nodes are there
            arrayify(graph['@graph']).filter(node => !(getId(node) in updMap))
          );
        } else {
          const overwriteMap = getNodeMap(
            updNodes.filter(node => getId(node) in nodeMap)
          );
          const newNodes = updNodes.filter(node => !(getId(node) in nodeMap));
          nextNodes = arrayify(graph['@graph'])
            .map(node => {
              const upd = overwriteMap[getId(node)];
              if (upd) {
                return updateNode(node, upd, { replaceArray: true });
              }
              return node;
            })
            .concat(newNodes);
        }

        const nextNodeMap = getNodeMap(nextNodes);

        // Some custom post-processsing

        // Be sure that the original encoding (e.g. DOCX for webify action)
        // _and_ the encoding this encoding isBasedOn are present and preserved

        // Example use case is Typesetting action: typesetter upload a DS3 doc
        // based on a PDF. We want to keep the PDF in the list of encoding of the
        // resource
        if (webifyAction && WEBIFY_ACTION_TYPES.has(webifyAction['@type'])) {
          const encoding = getObject(webifyAction);
          if (encoding) {
            const nextResource = nextNodes.find(
              node => getId(node) === getId(encoding.encodesCreativeWork)
            );

            if (nextResource) {
              const baseEncodingIds = getBaseEncodingIds(encoding, nextNodeMap);
              const backportedEncodingIds = [getId(encoding)]
                .concat(baseEncodingIds)
                .filter(encodingId => {
                  return (
                    encodingId &&
                    !arrayify(nextResource.encoding).some(
                      _encodingId => getId(_encodingId) === encodingId
                    )
                  );
                });

              if (backportedEncodingIds.length) {
                nextResource.encoding = arrayify(nextResource.encoding).concat(
                  backportedEncodingIds
                );
              }
            }
          }
        }

        // we set @type and alternate name for main entity if not available
        if (
          upsertedResourceId &&
          upsertedResourceId === getId(graph.mainEntity)
        ) {
          const nextResource = nextNodes.find(
            node => getId(node) === upsertedResourceId
          );
          if (nextResource) {
            const encodingType2ResourceType = {
              DataDownload: 'Dataset',
              ImageObject: 'Image',
              AudioObject: 'Audio',
              VideoObject: 'Video',
              FormulaObject: 'Formula',
              TextBoxObject: 'TextBox',
              SoftwareSourceCodeObject: 'SoftwareSourceCode',
              TableObject: 'Table',
              DocumentObject: 'ScholarlyArticle'
            };

            const encodingType2AlternateName = {
              DataDownload: 'Data',
              ImageObject: 'Image',
              AudioObject: 'Audio',
              VideoObject: 'Video',
              FormulaObject: 'Formula',
              TextBoxObject: 'Text Box',
              SoftwareSourceCodeObject: 'Code',
              TableObject: 'Table',
              DocumentObject: 'Article'
            };

            const encodingType = arrayify(nextResource.encoding)
              .concat(arrayify(nextResource.distribution))
              .map(encodingId => nextNodeMap[getId(encodingId)])
              .filter(Boolean)
              .map(encoding => encoding['@type'])
              .filter(Boolean)
              .find(type => type in encodingType2ResourceType);

            if (!nextResource['@type'] && encodingType) {
              nextResource['@type'] = encodingType2ResourceType[encodingType];
            }

            if (!nextResource.alternateName && encodingType) {
              nextResource.alternateName =
                encodingType2AlternateName[encodingType];
            }
          }
        }
      }

      const updatedMetadata = updateNode(
        omit(graph, ['@graph']),
        Object.assign(
          { dateModified: new Date().toISOString() },
          omit(updatePayload, ['@graph'])
        ),
        { replaceArray: true }
      );

      let nextGraph = Object.assign(
        updatedMetadata,
        nextNodes && nextNodes.length ? { '@graph': nextNodes } : undefined
      );

      // We purge the unlinked nodes
      if (nextGraph['@graph'] && getId(nextGraph.mainEntity)) {
        nextGraph = await purge(nextGraph, getId(nextGraph.mainEntity), {
          preserveUuidBlankNodes: true,
          removeUnnecessaryBlankNodeIds: true
        });
      }

      nextGraph = setEmbeddedIds(nextGraph);

      const messages = validateStylesAndAssets(nextGraph).concat(
        validateGraphNodes(nextGraph)
      );
      if (messages.length) {
        throw createError(400, messages.join(' ; '));
      }

      return nextGraph;
    },
    { store, ifMatch: action.ifMatch }
  );

  if (webifyActionResult) {
    // in case the object was an upload action we need to mark the UpdateAction
    // resulting from the webify action (`webifyActionResult`) as completed as well
    await this.update(
      webifyActionResult,
      action => {
        return Object.assign({}, action, {
          actionStatus: 'CompletedActionStatus',
          endTime: new Date().toISOString()
        });
      },
      { store }
    );
  }

  return savedGraph;
}

function getBaseEncodingIds(encoding, nodeMap, _baseEncodingIds = []) {
  arrayify(encoding.isBasedOn).forEach(baseEncodingId => {
    const baseEncoding = nodeMap[getId(baseEncodingId)];
    if (baseEncoding) {
      if (!_baseEncodingIds.some(id => getId(baseEncoding) === id)) {
        _baseEncodingIds.push(getId(baseEncoding));
        return getBaseEncodingIds(baseEncoding, nodeMap, _baseEncodingIds);
      }
    }
  });

  return _baseEncodingIds;
}
