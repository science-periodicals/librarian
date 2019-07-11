import zmq from 'zeromq';
import pick from 'lodash/pick';
import once from 'once';
import isPlainObject from 'lodash/isPlainObject';
import createError from '@scipe/create-error';
import { getId, arrayify, getNodeMap } from '@scipe/jsonld';
import schema from '../utils/schema';
import getScopeId from '../utils/get-scope-id';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import setId from '../utils/set-id';
import {
  getAgentId,
  getObject,
  getRootPartId,
  getResult
} from '../utils/schema-utils';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { parseRoleIds } from '../utils/role-utils';
import { getEmbeddedNodeAndProp } from '../utils/embed-utils';
import isArchive from '../utils/is-archive';
import { validateParticipantsRestrictedToAuthorsAndProducers } from '../validators';
import { getMetaActionParticipants } from '../utils/workflow-utils';
import addPromiseSupport from '../utils/add-promise-support';

/**
 * First call is with a webify action in `PotentialActionStatus`.
 * After that only `actionStatus`, `result` and `error` can be mutated
 *
 * Difficulty: the `object` (encoding) may not be in CouchDB by the time a
 * worker call this method to update the action status
 * => be sure to get the encoding with `this.get` _and_ fallback on
 *  `this.getEncodingByContentUrl`
 * TODO add a test for that ^^
 */
export default addPromiseSupport(function handleWebifyAction(
  action,
  {
    store,
    rpc,
    rpcTimeout = 10 * 60 * 1000, // 10 min
    isRetrying,
    prevAction,
    uploadAction // when webify action is started from an upload, the encoding is not saved yet => we need the uploadAction.result to access it
  } = {},
  callback
) {
  once(callback);

  // If the action was Canceled already, do nothing else
  // This is important as there is a race condition between the worker and the
  // cancel action handler
  if (prevAction && prevAction.actionStatus === 'CanceledActionStatus') {
    return callback(null, prevAction);
  }

  // Note encoding is validated further down
  if (!action.object) {
    return callback(
      createError(
        400,
        'webify actions must have a valid object pointing to a MediaObject (or subclass thereof)'
      )
    );
  }

  // we need a valid `userId` for workers (userId will be validated downstream,
  // here we just validate that agent is defined)
  if (!(getId(action.agent) || getAgentId(action.agent))) {
    return callback(createError(400, 'webify actions must have a valid agent'));
  }

  if (
    (action.actionStatus !== 'PotentialActionStatus' && !prevAction) ||
    (action.actionStatus === 'PotentialActionStatus' && prevAction)
  ) {
    return callback(
      createError(
        400,
        `${
          action['@type']
        } must first be posted with an actionStatus of PotentialActionStatus (got ${
          action.actionStatus
        } for ${getId(action)} )`
      )
    );
  }

  getEncoding.call(this, action, uploadAction, { store }, (err, encoding) => {
    if (err) return callback(err);

    if (
      !schema.is(encoding, 'MediaObject') ||
      !encoding.contentUrl ||
      !encoding.fileFormat ||
      !getId(encoding.encodesCreativeWork) ||
      !getId(encoding.isNodeOf)
    ) {
      return callback(
        createError(
          400,
          'webify actions must have a valid object pointing to a MediaObject (or subclass thereof) and having valid contentUrl, fileFormat, encodesCreativeWork and isNodeOf properties'
        )
      );
    }

    const scopeId = getScopeId(encoding);

    const toFetch = [scopeId];
    // if scope is a Graph, re-embed the contentChecksum
    if (!prevAction && scopeId.startsWith('graph:') && !uploadAction) {
      toFetch.push(
        ...arrayify(encoding.contentChecksum)
          .map(id => getId(id))
          .filter(Boolean)
      );
    }
    if (!toFetch.some(id => getId(id) === getId(encoding.isNodeOf))) {
      toFetch.push(getId(encoding.isNodeOf));
    }

    this.get(toFetch, { store, acl: false }, (err, fetched) => {
      if (err) return callback(err);
      const fetchedMap = getNodeMap(fetched);

      // validate that encoding is a node of the resource itself embedded in isNodeOf
      const embedderDoc = fetchedMap[getId(encoding.isNodeOf)];
      if (!embedderDoc) {
        return callback(
          createError(
            400,
            `${action['@type']} object.isNodeOf (${getId(
              encoding.isNodeOf
            )}) could not be found`
          )
        );
      }

      const [resource, resourceProp] = getEmbeddedNodeAndProp(
        getId(encoding.encodesCreativeWork),
        embedderDoc
      );
      if (!resource) {
        return callback(
          createError(
            400,
            `${action['@type']} object.encodesCreativeWork (${getId(
              encoding.encodesCreativeWork
            )}) could not be found`
          )
        );
      }

      // Validate action['@type']
      const type = encoding.fileFormat.split('/')[0].trim(); // we use encoding.fileFormat as it may have been corrected by createBlob
      const cType = encoding.fileFormat.split(';')[0].trim();

      switch (action['@type']) {
        case 'ImageProcessingAction':
          if (type !== 'image' || cType === 'image/svg+xml') {
            return callback(
              createError(
                400,
                `${
                  action['@type']
                } can only be used for image encoding (excluding svg), got ${
                  encoding.fileFormat
                }`
              )
            );
          }
          break;
        case 'AudioVideoProcessingAction':
          if (type !== 'audio' && type !== 'video') {
            return callback(
              createError(
                400,
                `${
                  action['@type']
                } can only be used for audio and video encoding, got ${
                  encoding.fileFormat
                }`
              )
            );
          }
          break;
        case 'DocumentProcessingAction':
          // only mainEntity can be converted
          if (
            getId(resource) !== getId(embedderDoc.mainEntity) ||
            !isArchive(encoding.fileFormat)
          ) {
            return callback(
              createError(
                400,
                `${action['@type']} can only be used for the mainEntity ${getId(
                  embedderDoc.mainEntity
                )} and not ${getId(resource)}`
              )
            );
          }
          break;
      }

      const scope = fetchedMap[scopeId];
      if (encoding.contentChecksum) {
        encoding = Object.assign({}, encoding, {
          contentChecksum: arrayify(encoding.contentChecksum).map(
            contentChecksum => {
              return fetchedMap[getId(contentChecksum)] || contentChecksum;
            }
          )
        });
      }

      // validate `agent`
      resolveAgent.call(
        this,
        action.agent,
        embedderDoc,
        scope,
        { store },
        (err, resolvedAgent) => {
          if (err) return callback(err);

          const handledAgent = remapRole(resolvedAgent, 'agent', {
            dates: false
          });

          // we need a userId for worker (PUB/SUB uses userId as namespacce)
          const { userId } = parseRoleIds(handledAgent);
          if (!userId) {
            return callback(
              createError(
                400,
                `${
                  action['@type']
                } error:  invalid agent, no userId could be found for ${getId(
                  action.agent
                ) || getAgentId(action.agent)} `
              )
            );
          }

          // validate participants:
          // for live graph, they must only include authors and producers to
          // guarantee that author visibility is not an issue
          if (
            action.participant &&
            scope['@type'] === 'Graph' &&
            scope.version == null
          ) {
            const messages = validateParticipantsRestrictedToAuthorsAndProducers(
              action.participant,
              scope
            );
            if (messages.length) {
              throw createError(403, messages.join(' '));
            }
          }

          switch (action.actionStatus) {
            case 'PotentialActionStatus': {
              action = setId(
                handleParticipants(
                  Object.assign(
                    {
                      actionStatus: 'PotentialActionStatus',
                      startTime: new Date().toISOString()
                    },
                    action,
                    {
                      agent: handledAgent,
                      object: encoding
                    }
                  ),
                  scope
                ),
                createId('action', action, scope)
              );

              if (!getId(action.result)) {
                // add result to action so that we know the @id of the resulting update action (convenient for the changes feed)
                const resultId = createId(
                  'action',
                  getId(action.result),
                  scope
                )['@id'];
                action.result = isPlainObject(action.result)
                  ? setId(action.result, resultId)
                  : resultId;
              }

              this.put(action, { store, force: true }, (err, action) => {
                if (err) return callback(err);

                // in RPC mode, we wait to callback untill we know the action is completed
                let sub;
                if (rpc) {
                  sub = zmq.socket('sub');
                  sub.connect(this.XPUB_ENDPOINT);
                  sub.subscribe(getAgentId(action.agent));
                }

                this.log.trace(
                  { action, rpc },
                  'librarian.handleWebifyAction dispatch to worker'
                );

                addParams.call(
                  this,
                  action,
                  scopeId,
                  resourceProp,
                  { store },
                  (err, actionWithParams) => {
                    if (err) {
                      return callback(err);
                    }

                    this.dispatch(actionWithParams, err => {
                      if (err) {
                        return callback(err);
                      }

                      if (!rpc) {
                        return callback(null, actionWithParams);
                      }

                      //////////////////////////////////////////////////////////
                      // -- Normal case is done, below is for RPC mode only --//
                      //////////////////////////////////////////////////////////
                      const messages = []; // keep track of zmq messages for debugging

                      const fail = failedAction => {
                        this.log.error(
                          { actionWithParams, messages, failedAction },
                          'handle webify action: rpc failure or timeout'
                        );

                        try {
                          sub.close();
                        } catch (err) {
                          this.log.error(
                            { action, rpc },
                            'librarian.handleWebifyAction in rpc mode error when closing sub socket after timeout'
                          );
                        }

                        this.publish(
                          {
                            '@type': 'CancelAction',
                            agent: 'bot:librarian',
                            actionStatus: 'CompletedActionStatus',
                            object: getId(action)
                          },
                          err => {
                            if (err) {
                              this.log.error(
                                err,
                                'could not publish CancelAction'
                              );
                            }

                            this.put(
                              failedAction ||
                                Object.assign(
                                  {
                                    endTime: new Date().toISOString()
                                  },
                                  action,
                                  {
                                    actionStatus: 'FailedActionStatus',
                                    error: {
                                      '@type': 'Error',
                                      statusCode: 500,
                                      description: `No response from SUB socket before timeout (${rpcTimeout}ms) in handleWebifyAction`
                                    }
                                  }
                                ),
                              { store, force: true },
                              (err, failedAction) => {
                                if (err) {
                                  this.log.error(
                                    { err },
                                    'error writing failed webify action'
                                  );
                                }

                                callback(
                                  failedAction
                                    ? createError(
                                        Object.assign(
                                          {
                                            error: {
                                              '@type': 'Error',
                                              statusCode: 500,
                                              description:
                                                'Got a failed action on SUB socket'
                                            }
                                          },
                                          failedAction
                                        )
                                      )
                                    : createError(
                                        500,
                                        `handle webify action: SUB socket timeout (${rpcTimeout}ms)`
                                      )
                                );
                              }
                            );
                          }
                        );
                      };

                      let timeoutId = setTimeout(fail, rpcTimeout);

                      sub.on('message', (userId, payload) => {
                        userId = userId.toString();
                        payload = JSON.parse(payload);

                        messages.push({ userId, payload });

                        if (
                          getId(payload) === getId(action) &&
                          (payload.actionStatus === 'CompletedActionStatus' ||
                            payload.actionStatus === 'CanceledActionStatus')
                        ) {
                          // we are done
                          clearTimeout(timeoutId);
                          try {
                            sub.close();
                          } catch (err) {
                            this.log.error(
                              err,
                              'zmq sub socket could not be closed'
                            );
                            // noop
                          } finally {
                            callback(null, payload);
                          }
                        } else if (
                          getId(payload) === getId(action) &&
                          payload.actionStatus === 'FailedActionStatus'
                        ) {
                          // we error
                          clearTimeout(timeoutId);
                          fail(payload);
                        } else if (
                          getId(payload) === getId(action) ||
                          (payload['@type'] === 'ProgressEvent' &&
                            getId(payload.about) === getId(action))
                        ) {
                          // we are receiving relevant messages => we extend the timeout
                          clearTimeout(timeoutId);
                          timeoutId = setTimeout(fail, rpcTimeout);
                        }
                      });
                    });
                  }
                );
              });

              break;
            }

            case 'CompletedActionStatus': {
              let updateAction = getResult(action);
              if (!updateAction || updateAction['@type'] !== 'UpdateAction') {
                return callback(
                  createError(
                    400,
                    `invalid result for ${
                      action['@type']
                    } (need an UpdateAction)`
                  )
                );
              }

              updateAction = Object.assign(
                {},
                // Needed for Graph update action
                getId(action.instrumentOf)
                  ? {
                      instrumentOf: getId(action.instrumentOf)
                    }
                  : undefined,
                updateAction,
                {
                  agent: handledAgent
                },
                action.autoUpdate
                  ? {
                      actionStatus: 'CompletedActionStatus'
                    }
                  : undefined
              );

              if (action.participant && !updateAction.participant) {
                // Propagate the webify action participant (audiences)
                const updateActionParticipants = getMetaActionParticipants(
                  action
                );
                if (updateActionParticipants.length) {
                  updateAction.participant = updateActionParticipants;
                }
              }

              // POST the UpdateAction
              this.post(
                updateAction,
                { acl: false, mode: 'document' },
                (err, updateAction) => {
                  if (err) return callback(err);
                  // if (and only if) the UpdateAction is on CouchDB, mark the original action as completed

                  const handledAction = handleParticipants(
                    Object.assign(
                      {
                        endTime: action.endTime || new Date().toISOString()
                      },
                      prevAction,
                      {
                        agent: handledAgent
                      },
                      pick(action, ['actionStatus', 'error', 'result'])
                    ),
                    scope
                  );

                  this.put(
                    Object.assign({}, handledAction, {
                      result: getId(updateAction)
                    }),
                    { force: true, store },
                    (err, savedAction) => {
                      if (err) return callback(err);
                      callback(
                        null,
                        Object.assign({}, savedAction, {
                          result: updateAction
                        })
                      );
                    }
                  );
                }
              );
              break;
            }

            default: {
              const handledAction = handleParticipants(
                Object.assign(
                  {},
                  action.actionStatus === 'StagedActionStatus'
                    ? { stagedTime: new Date().toISOString() }
                    : undefined,
                  action.actionStatus === 'CompletedActionStatus' ||
                    action.actionStatus === 'FailedActionStatus' ||
                    action.actionStatus === 'CanceledActionStatus'
                    ? {
                        endTime: new Date().toISOString()
                      }
                    : undefined,
                  prevAction,
                  {
                    agent: handledAgent
                  },
                  pick(action, ['actionStatus', 'error', 'result'])
                ),
                scope
              );

              this.put(handledAction, { force: true, store }, callback);
              break;
            }
          }
        }
      );
    });
  });
});

function getEncoding(action, uploadAction, { store } = {}, callback) {
  if (uploadAction) {
    return callback(null, uploadAction.result);
  }
  const object = getObject(action);

  this.get(getId(object), { store, acl: false }, (err, encoding) => {
    if (err) {
      if (err.code === 404) {
        // encoding may not be in the DB yet
        this.getPendingEncodingByContentUrl(
          object.contentUrl,
          { store },
          callback
        );
      } else {
        callback(err);
      }
    } else {
      callback(null, encoding);
    }
  });
}

function addParams(action, scopeId, resourceProp, { store } = {}, callback) {
  switch (action['@type']) {
    case 'DocumentProcessingAction':
      this.getUnroledIdToRoleIdMap(
        scopeId,
        { store },
        (err, unroledIdToRoleIdMap) => {
          if (err) return callback(err);

          callback(
            null,
            Object.assign(
              {
                params: {
                  unroledIdToRoleIdMap,
                  flattenUpdateActionResult: resourceProp === '@graph'
                }
              },
              action
            )
          );
        }
      );
      break;

    default:
      callback(
        null,
        Object.assign(
          { params: { flattenUpdateActionResult: resourceProp === '@graph' } },
          action
        )
      );
  }
}

function resolveAgent(agent, embedderDoc, scope, { store } = {}, callback) {
  if (scope['@type'] === 'Graph' && embedderDoc.version != null) {
    // in case of releases, a journal role can upload style (banners etc.)
    // => we also try to resolve `agent` from the journal

    const resolvedAgent = findRole(agent, scope, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (resolvedAgent) {
      return callback(null, resolvedAgent);
    }

    const journalId = getRootPartId(scope);
    if (journalId) {
      this.get(
        journalId,
        {
          store,
          acl: false
        },
        (err, journal) => {
          if (err) return callback(err);

          const resolvedAgent = findRole(agent, journal, {
            ignoreEndDateOnPublicationOrRejection: true
          });

          callback(null, resolvedAgent || agent);
        }
      );
    } else {
      callback(null, agent);
    }
  } else if (scope['@type'] === 'Graph' && embedderDoc.version == null) {
    // live Graph => agent MUST be from graph;
    const resolvedAgent = findRole(agent, scope, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (!resolvedAgent) {
      return callback(
        createError(400, `Invalid agent, agent must be part of ${getId(scope)}`)
      );
    }

    callback(null, resolvedAgent);
  } else {
    // no constraints
    callback(
      null,
      findRole(agent, scope, {
        ignoreEndDateOnPublicationOrRejection: true
      }) || agent
    );
  }
}
