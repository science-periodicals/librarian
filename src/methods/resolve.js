import querystring from 'querystring';
import pick from 'lodash/pick';
import cloneDeep from 'lodash/cloneDeep';
import createError from '@scipe/create-error';
import {
  getId,
  unprefix,
  arrayify,
  dearrayify,
  getNodeMap
} from '@scipe/jsonld';
import Store from '../utils/store';
import getScopeId from '../utils/get-scope-id';
import { getObject, getObjectId, getAgentId } from '../utils/schema-utils';
import { getStageActions } from '../utils/workflow-utils';
import remapRole from '../utils/remap-role';
import { getGraphMainEntityContributorRoles } from '../utils/role-utils';
import createId from '../create-id';

/**
 * Action resolver.
 *
 *  This is mostly needed for stories where we need to know the @id of the workflow
 *  action ahead of their instantiation
 */
export default async function resolve(
  action,
  { store = new Store(), strict = true } = {}
) {
  // only try to resolve when `strict` is `false`
  if (strict) {
    return action;
  }

  switch (action['@type']) {
    case 'CheckAction': {
      // reconcile:
      // @id: ?graph=graphId -> checkActionId
      // agent: userId?roleName=<roleName>&graph=<graphId>&source=mainEntity -> main entity roleId
      const actionId = getId(action);
      const agentId = getId(action.agent);

      // Reconcile the agent into the roleId
      let agent;
      if (agentId && agentId.includes('graph=')) {
        const { graph: graphQuery, roleName, source } = querystring.parse(
          agentId.split('?')[1]
        );

        if (!source || source !== 'mainEntity') {
          throw createError(
            400,
            `Resolver could not resolve "agent" for value ${agentId}, "source=mainEntity" parameter is missing`
          );
        }

        if (
          !roleName ||
          (roleName !== 'author' && roleName !== 'contributor')
        ) {
          throw createError(
            400,
            `Resolver could not resolve "agent" for value ${agentId}, "roleName=author|contributor" parameter is missing`
          );
        }

        const graph = await this.get(getScopeId(`graph:${graphQuery}`), {
          acl: false,
          store
        });

        const userId = agentId.split('?')[0];
        const roles = getGraphMainEntityContributorRoles(graph);

        const role = roles.find(
          role => getAgentId(role) === userId && role.roleName === roleName
        );
        if (!role) {
          throw createError(
            400,
            `Resolver could not resolve "agent" for value ${agentId}`
          );
        }

        agent = remapRole(role, 'agent', { dates: false });
        action = Object.assign({}, action, { agent });
      }

      // Reconcile @id (needs to be executed after the agent was reconciled)
      if (actionId && actionId.includes('graph=')) {
        const { graph: graphQuery } = querystring.parse(actionId.split('?')[1]);

        const checkActions = await this.getActionsByScopeIdAndTypes(
          getScopeId(`graph:${getScopeId(graphQuery)}`),
          ['CheckAction'],
          { store }
        );

        const checkAction = checkActions.find(
          checkAction => getId(checkAction.agent) === getId(action.agent)
        );

        if (!checkAction) {
          throw createError(
            400,
            `Resolver could not resolve "@id" for value ${actionId}`
          );
        }

        action = Object.assign({}, action, { '@id': getId(checkAction) });
      }

      break;
    }

    case 'AssessAction': {
      // resolve @id and or result (in stories they are specified as result: {instanceOf: _:templateId}) and comment and annotations
      const actionId = getId(action);
      if (
        actionId &&
        actionId.startsWith('_:') &&
        actionId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, actionId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "@id" for value ${actionId}`
          );
        }

        let resolvedResultId;
        if (action.result && action.result.instanceOf) {
          const resultInstanceOfId = getId(action.result.instanceOf);

          if (resultInstanceOfId) {
            const resultTemplateId = `workflow:${
              unprefix(resultInstanceOfId).split('?')[0]
            }`;

            const result = arrayify(resolvedItem.potentialResult).find(
              potentialResult =>
                getId(potentialResult.instanceOf) === resultTemplateId
            );

            resolvedResultId = getId(result);
          }
        }

        const resolvedAnnotations = await resolveAnnotations.call(
          this,
          action.annotation,
          { store }
        );

        const resolvedComments = await resolveComments.call(
          this,
          action.comment,
          { store }
        );

        return Object.assign(
          {},
          action,
          pick(resolvedItem, ['@id', 'instanceOf', 'resultOf']),
          resolvedResultId ? { result: resolvedResultId } : undefined,
          resolvedAnnotations ? { annotation: resolvedAnnotations } : undefined,
          resolvedComments ? { comment: resolvedComments } : undefined
        );
      }
      break;
    }

    case 'ReviewAction':
    case 'CreateReleaseAction': {
      // resolve @id, annotation and comment
      const actionId = getId(action);
      if (
        actionId &&
        actionId.startsWith('_:') &&
        actionId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, actionId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "@id" for value ${actionId}`
          );
        }

        const resolvedAnnotations = await resolveAnnotations.call(
          this,
          action.annotation,
          { store }
        );

        const resolvedComments = await resolveComments.call(
          this,
          action.comment,
          { store }
        );

        return Object.assign(
          {},
          action,
          pick(resolvedItem, ['@id', 'instanceOf', 'resultOf']),
          resolvedAnnotations ? { annotation: resolvedAnnotations } : undefined,
          resolvedComments ? { comment: resolvedComments } : undefined
        );
      }
      break;
    }

    case 'DeclareAction':
    case 'PublishAction':
    case 'PayAction': {
      // resolve @id
      const actionId = getId(action);
      if (
        actionId &&
        actionId.startsWith('_:') &&
        actionId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, actionId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "@id" for value ${actionId}`
          );
        }

        return Object.assign(
          {},
          action,
          pick(resolvedItem, ['@id', 'instanceOf', 'resultOf'])
        );
      }
      break;
    }

    case 'BuyAction': {
      // resolve instrumentOf (a workflowAction)
      const instrumentOfId = getId(action.instrumentOf);
      if (
        instrumentOfId &&
        instrumentOfId.startsWith('_:') &&
        instrumentOfId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(
          this,
          instrumentOfId,
          {
            store
          }
        );

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "instrumentOf" for value ${instrumentOfId}`
          );
        }

        return Object.assign({}, action, {
          instrumentOf: getId(resolvedItem)
        });
      }

      break;
    }

    case 'ReplyAction': {
      // resolve object (a question). We use a ?question=<index> qs
      const objectId = getObjectId(action);
      if (
        objectId &&
        objectId.startsWith('_:') &&
        objectId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, objectId, {
          store
        });

        const questionId = getResolvedQuestionId(objectId, resolvedItem);
        if (!resolvedItem || !questionId) {
          throw createError(
            400,
            `Resolver could not resolve "object" for value ${objectId}`
          );
        }

        return Object.assign({}, action, {
          object: questionId
        });
      }
      break;
    }

    case 'AssignAction':
    case 'UnassignAction':
    case 'CancelAction':
    case 'ScheduleAction': {
      // resolve object (a workflow action)
      const objectId = getObjectId(action);

      if (
        objectId &&
        objectId.startsWith('_:') &&
        objectId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, objectId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "object" for value ${objectId}`
          );
        }

        return Object.assign({}, action, { object: getId(resolvedItem) });
      }
      break;
    }

    case 'EndorseAction': {
      // resolve object (workflow action) and / or @id
      const actionId = getId(action);
      const objectId = getObjectId(action);

      if (
        objectId &&
        objectId.startsWith('_:') &&
        objectId.includes('instance=')
      ) {
        const {
          resolvedItem: resolvedObject,
          stageActions
        } = await getResolvedItem.call(this, objectId, { store });

        if (!resolvedObject) {
          throw createError(
            400,
            `Resolver could not resolve "object" for value ${objectId}`
          );
        }

        const resolvedItem = stageActions.find(
          action =>
            action['@type'] === 'EndorseAction' &&
            getObjectId(action) == getId(resolvedObject)
        );

        return Object.assign(
          {},
          action,
          pick(resolvedItem, ['@id', 'object', 'instanceOf', 'resultOf'])
        );
      } else if (
        actionId &&
        actionId.startsWith('_:') &&
        actionId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, actionId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "@id" for value ${actionId}`
          );
        }

        return Object.assign(
          {},
          action,
          pick(resolvedItem, ['@id', 'object', 'instanceOf', 'resultOf'])
        );
      }
      break;
    }

    case 'UploadAction': {
      // resolve instrumentOf (workflow action) and / or object.encodesCreativeWork (a resource)

      const overwrite = {};

      const instrumentOfId = getId(action.instrumentOf);
      if (
        instrumentOfId &&
        instrumentOfId.startsWith('_:') &&
        instrumentOfId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(
          this,
          instrumentOfId,
          {
            store
          }
        );

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "instrumentOf" for value ${instrumentOfId}`
          );
        }

        overwrite.instrumentOf = getId(resolvedItem);
      }

      const encodesCreativeWorkId = getId(
        getObject(action) && getObject(action).encodesCreativeWork
      );
      if (
        encodesCreativeWorkId &&
        encodesCreativeWorkId.includes('partAlternateName=')
      ) {
        const { partAlternateName, graph: graphQs } = querystring.parse(
          encodesCreativeWorkId.split('?')[1]
        );
        const graphId = `graph:${graphQs}`;

        //get graph nodes from the full graph (to resolve the encodesCreateWork id)
        const graph = await this.get(graphId, {
          acl: false,
          store
        });

        const node = arrayify(graph['@graph']).find(
          node =>
            node.alternateName === partAlternateName &&
            getId(node.isNodeOf) === graphId
        );

        overwrite.object = Object.assign({}, action.object, {
          encodesCreativeWork: getId(node),
          isNodeOf: graphId
        });
      }

      if (Object.keys(overwrite).length) {
        return Object.assign({}, action, overwrite);
      }
      break;
    }

    case 'CommentAction': {
      // resolve the object (a workflow action), the (nested) selector (`node`, `selectedItem`) and the resultComment

      const objectId = getObjectId(action);

      if (
        objectId &&
        objectId.startsWith('_:') &&
        objectId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(this, objectId, {
          store
        });

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "object" for value ${objectId}`
          );
        }

        let resolvedSelector;
        if (action.object.hasSelector) {
          resolvedSelector = await resolveSelector.call(
            this,
            action.object.hasSelector,
            {
              store
            }
          );
        }

        let resolvedResultComment;
        if (action.resultComment) {
          resolvedResultComment = await resolveComments.call(
            this,
            action.resultComment,
            { store }
          );
        }

        return Object.assign(
          {},
          action,
          {
            object:
              typeof action.object === 'string'
                ? getId(resolvedItem)
                : action.object.object
                ? Object.assign(
                    {},
                    action.object,
                    { object: getId(resolvedItem) },
                    resolvedSelector
                      ? {
                          hasSelector: resolvedSelector
                        }
                      : undefined
                  )
                : Object.assign({}, action.object, {
                    '@id': getId(resolvedItem)
                  })
          },
          resolvedResultComment
            ? { resultComment: resolvedResultComment }
            : undefined
        );
      }
      break;
    }

    case 'UpdateAction': {
      // resolve instrumentOf (workflow action)
      const overwrite = {};

      const instrumentOfId = getId(action.instrumentOf);
      if (
        instrumentOfId &&
        instrumentOfId.startsWith('_:') &&
        instrumentOfId.includes('instance=')
      ) {
        const { resolvedItem } = await getResolvedItem.call(
          this,
          instrumentOfId,
          {
            store
          }
        );

        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve "instrumentOf" for value ${instrumentOfId}`
          );
        }

        overwrite.instrumentOf = getId(resolvedItem);
      }

      if (Object.keys(overwrite).length) {
        return Object.assign({}, action, overwrite);
      }
      break;
    }

    case 'TypesettingAction': {
      // {
      //   '@type': 'TypesettingAction',
      //   comment: {
      //     '@type': 'RevisionRequestComment',
      //     ifMatch: 'node:nodeId?checksum=sha256' // <- gets resolved to checksum value
      //   }
      // };

      const resolvedMap = {};
      for (const comment of arrayify(action.comment)) {
        if (
          comment &&
          comment.ifMatch &&
          comment.ifMatch.includes('checksum=')
        ) {
          const algo = querystring.parse(comment.ifMatch.split('?')[1])
            .checksum;

          const encodingId = comment.ifMatch.split('?')[0];
          const encoding = await this.get(encodingId, { acl: false, store });
          if (encoding && encoding.contentChecksum) {
            const graph = await this.get(encoding.isNodeOf, {
              acl: false,
              store
            });
            const nodeMap = getNodeMap(graph);
            const checksum = arrayify(encoding.contentChecksum)
              .map(id => nodeMap[id])
              .find(checksum => checksum.checksumAlgorithm === algo);
            if (checksum) {
              resolvedMap[comment.ifMatch] = checksum.checksumValue;
            }
          }
        }
      }

      if (Object.keys(resolvedMap).length) {
        return Object.assign({}, action, {
          comment: dearrayify(
            action.comment,
            arrayify(action.comment).map(comment => {
              if (
                comment &&
                comment.ifMatch &&
                comment.ifMatch in resolvedMap
              ) {
                return Object.assign({}, comment, {
                  ifMatch: resolvedMap[comment.ifMatch]
                });
              }
              return comment;
            })
          )
        });
      }

      break;
    }

    case 'InviteAction': {
      // resolve `purpose` (purpose=_:templateId??instance=<>&graph=<>&cycle=<>)
      if (action.purpose) {
        return Object.assign({}, action, {
          purpose: dearrayify(
            action.purpose,
            await Promise.all(
              arrayify(action.purpose).map(async purpose => {
                const purposeId = getId(purpose);
                if (purposeId && purposeId.includes('instance=')) {
                  const { resolvedItem } = await getResolvedItem.call(
                    this,
                    purposeId,
                    {
                      store
                    }
                  );

                  return getId(resolvedItem);
                }

                return purpose;
              })
            )
          )
        });
      }
      break;
    }

    default:
      break;
  }

  return action;
}

/**
 * !! this only takes care of ?instance=<>&graph=<>&cycle=<>
 * It does not handel ?question=, ?answer=, ?review= or ?partAlternateName=
 */
async function getResolvedItem(idToResolve, { store } = {}) {
  const {
    instance: instanceQuery,
    cycle: cycleQuery,
    graph: graphQuery
  } = querystring.parse(idToResolve.split('?')[1]);

  const graphId = `graph:${graphQuery}`;
  const instanceIndex = parseInt(instanceQuery, 10); // instance is always defined
  const cycleIndex = cycleQuery ? parseInt(cycleQuery, 10) : 0;

  // - get all the stages involving `templateId` for `graphId`
  const templateId = `workflow:${unprefix(idToResolve).split('?')[0]}`;

  // cycles are all the occurences of 1 stage
  const cycles = await this.getInstantiatedStagesByGraphIdAndTemplateId(
    graphId,
    templateId,
    {
      store
    }
  );

  const sortedCycles = cycles.sort((a, b) => {
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  const stage = sortedCycles[cycleIndex];

  const stageActions = getStageActions(stage);

  const instances = stageActions
    .filter(action => getId(action.instanceOf) === templateId)
    .sort((a, b) => {
      // !! we don't rely on the @id as they are UUID so they could change each time we re-run a story
      // => we use the identifier that will sort in a stable fashion each time we re-run a story
      const [s1, a1, e1] = a.identifier.split('.');
      const [s2, a2, e2] = b.identifier.split('.');

      if (a1 === a2) {
        return a.identifier.localeCompare(b.identifier);
      }
      return parseInt(a1, 10) - parseInt(a2, 10);
    });

  let resolvedItem = instances[instanceIndex];

  if (!resolvedItem) {
    // item may be an InformAction or an EmailMessage of an AssessAction
    const assessAction = stageActions.find(
      action => action['@type'] === 'AssessAction'
    );

    if (assessAction) {
      loop1: for (const action of arrayify(assessAction.potentialAction)) {
        if (getId(action.instanceOf) === templateId) {
          resolvedItem = action;
          break loop1;
        }
        for (const instrument of arrayify(action.instrument)) {
          if (getId(instrument.instanceOf) === templateId) {
            resolvedItem = instrument;
            break loop1;
          }
        }
      }
    }
  }

  if (!resolvedItem) {
    this.log.error(
      {
        idToResolve,
        graphId,
        instanceIndex,
        cycleIndex,
        cycles,
        instanceQuery,
        graphQuery,
        cycleQuery,
        stage,
        instances,
        templateId,
        stageActions,
        resolvedItem
      },
      'Could not resolve item'
    );
  }

  return {
    resolvedItem,
    stage,
    templateId,
    stageActions
  };
}

function getResolvedQuestionId(idToResolve, resolvedAction = {}) {
  if (
    resolvedAction['@type'] === 'DeclareAction' ||
    resolvedAction['@type'] === 'ReviewAction'
  ) {
    let questionIds;

    if (resolvedAction['@type'] === 'DeclareAction') {
      questionIds = arrayify(resolvedAction.question).map(getId);
    } else if (resolvedAction['@type'] === 'ReviewAction') {
      questionIds = arrayify(resolvedAction.answer)
        .map(answer => answer.parentItem)
        .map(getId);
    }
    if (questionIds) {
      const { question } = querystring.parse(idToResolve.split('?')[1]);
      const questionIndex = question ? parseInt(question, 10) : 0;
      return getId(questionIds[questionIndex]);
    }
  }
}

function getResolvedAnswerId(idToResolve, resolvedAction = {}) {
  if (
    resolvedAction['@type'] === 'DeclareAction' ||
    resolvedAction['@type'] === 'ReviewAction'
  ) {
    let answerIds;

    if (resolvedAction['@type'] === 'DeclareAction') {
      answerIds = arrayify(resolvedAction.result).map(getId);
    } else if (resolvedAction['@type'] === 'ReviewAction') {
      answerIds = arrayify(resolvedAction.answer).map(getId);
    }
    if (answerIds) {
      const { answer } = querystring.parse(idToResolve.split('?')[1]);
      const answerIndex = answer ? parseInt(answer, 10) : 0;
      return getId(answerIds[answerIndex]);
    }
  }
}

async function resolveSelector(unresolvedSelector, { store } = {}) {
  const resolvedSelector = cloneDeep(unresolvedSelector);

  let selector = resolvedSelector;

  while (selector) {
    for (const p of ['node', 'selectedItem']) {
      const idToResolve = getId(selector[p]);
      if (
        idToResolve &&
        idToResolve.startsWith('_:') &&
        idToResolve.includes('instance=')
      ) {
        // special case for cNode
        if (idToResolve.includes('@')) {
          try {
            selector[p] = await resolveCnode.call(this, idToResolve, { store });
            continue;
          } catch (err) {
            // nope;
          }
        }

        const { resolvedItem } = await getResolvedItem.call(this, idToResolve, {
          store
        });
        if (!resolvedItem) {
          throw createError(
            400,
            `Resolver could not resolve ${p} for value ${idToResolve}`
          );
        }

        // question, answer, review are mutually exclusive
        const { question, answer, review } = querystring.parse(
          idToResolve.split('?')[1]
        );
        if (question != null) {
          const questionId = getResolvedQuestionId(idToResolve, resolvedItem);

          if (!questionId) {
            throw createError(
              400,
              `Resolver could not resolve "question for value ${idToResolve}`
            );
          }

          selector[p] = questionId;
        } else if (answer != null) {
          const answerId = getResolvedAnswerId(idToResolve, resolvedItem);

          if (!answerId) {
            throw createError(
              400,
              `Resolver could not resolve "answer" for value ${idToResolve}`
            );
          }

          selector[p] = answerId;
        } else if (review != null) {
          if (
            resolvedItem['@type'] !== 'ReviewAction' ||
            !getId(resolvedItem.resultReview)
          ) {
            throw createError(
              400,
              `Resolver could not resolve "review" for value ${idToResolve}`
            );
          }

          selector[p] = getId(resolvedItem.resultReview);
        } else {
          selector[p] = getId(resolvedItem);
        }
      }
    }
    selector = selector.hasSubSelector;
  }

  return resolvedSelector;
}

async function resolveAnnotations(annotations, { store } = {}) {
  const resolvedAnnotations = [];
  if (annotations) {
    for (const annotation of arrayify(annotations)) {
      const resolvedAnnotationId = await resolveCnode.call(
        this,
        getId(annotation),
        { store }
      );

      // Note: resolving annotation target should never be necessary as annotations only target graphs
      // It may become usefull when we can resolve DS3 bookmarks
      let resolvedAnnotationTarget;
      if (annotation.annotationTarget) {
        if (annotation.annotationTarget.hasSelector) {
          const resolvedSelector = await resolveSelector.call(
            this,
            annotation.annotationTarget.hasSelector,
            {
              store
            }
          );
          resolvedAnnotationTarget = Object.assign(
            {},
            annotation.annotationTarget,
            {
              hasSelector: resolvedSelector
            }
          );
        }
      }

      let resolvedAnnotationBody;
      if (annotation.annotationBody) {
        const resolvedId = await resolveCnode.call(
          this,
          getId(annotation.annotationBody),
          { store }
        );
        const resolvedParentItemId = await resolveCnode.call(
          this,
          getId(annotation.annotationBody.parentItem),
          { store }
        );

        let resolvedIsBasedOn;

        if (annotation.annotationBody.isBasedOn) {
          resolvedIsBasedOn = dearrayify(
            annotation.annotationBody.isBasedOn,
            await Promise.all(
              arrayify(annotation.annotationBody.isBasedOn).map(
                async isBasedOn => {
                  const uri = getId(isBasedOn);
                  if (
                    uri &&
                    uri.startsWith('_:') &&
                    uri.includes('instance=')
                  ) {
                    const { resolvedItem } = await getResolvedItem.call(
                      this,
                      getId(isBasedOn),
                      {
                        store
                      }
                    );
                    return resolvedItem ? getId(resolvedItem) : isBasedOn;
                  }

                  return isBasedOn;
                }
              )
            )
          );
        }

        if (resolvedIsBasedOn || resolvedParentItemId || resolvedId) {
          resolvedAnnotationBody = Object.assign(
            {},
            annotation.annotationBody,
            resolvedId ? { '@id': resolvedId } : undefined,
            resolvedParentItemId
              ? { parentItem: resolvedParentItemId }
              : undefined,
            resolvedIsBasedOn
              ? {
                  isBasedOn: resolvedIsBasedOn
                }
              : undefined
          );
        }
      }

      resolvedAnnotations.push(
        Object.assign(
          {},
          annotation,
          resolvedAnnotationId ? { '@id': resolvedAnnotationId } : undefined,
          resolvedAnnotationTarget
            ? {
                annotationTarget: resolvedAnnotationTarget
              }
            : undefined,
          resolvedAnnotationBody
            ? {
                annotationBody: resolvedAnnotationBody
              }
            : undefined
        )
      );
    }
  }

  return resolvedAnnotations.length
    ? dearrayify(annotations, resolvedAnnotations)
    : undefined;
}

async function resolveComments(comments, { store } = {}) {
  const resolvedComments = [];

  if (comments) {
    for (const comment of arrayify(comments)) {
      const resolvedId = await resolveCnode.call(this, getId(comment), {
        store
      });
      const resolvedParentItemId = await resolveCnode.call(
        this,
        getId(comment.parentItem),
        { store }
      );

      let resolvedIsBasedOn;
      if (comment.isBasedOn) {
        resolvedIsBasedOn = dearrayify(
          comment.isBasedOn,
          await Promise.all(
            arrayify(comment.isBasedOn).map(async isBasedOn => {
              const uri = getId(isBasedOn);
              if (uri && uri.startsWith('_:') && uri.includes('instance=')) {
                const { resolvedItem } = await getResolvedItem.call(
                  this,
                  getId(isBasedOn),
                  {
                    store
                  }
                );
                return resolvedItem ? getId(resolvedItem) : isBasedOn;
              }

              return isBasedOn;
            })
          )
        );
      }

      resolvedComments.push(
        Object.assign(
          {},
          comment,
          resolvedId ? { '@id': resolvedId } : undefined,
          resolvedParentItemId
            ? { parentItem: resolvedParentItemId }
            : undefined,
          resolvedIsBasedOn
            ? {
                isBasedOn: resolvedIsBasedOn
              }
            : undefined
        )
      );
    }
  }

  return resolvedComments.length
    ? dearrayify(comments, resolvedComments)
    : undefined;
}

async function resolveCnode(cnodeTemplateId, { store } = {}) {
  cnodeTemplateId = getId(cnodeTemplateId);

  if (
    cnodeTemplateId &&
    cnodeTemplateId.startsWith('_:') &&
    cnodeTemplateId.includes('@') &&
    cnodeTemplateId.includes('instance=')
  ) {
    const [uuid, templateId] = cnodeTemplateId.split('@');

    const { resolvedItem } = await getResolvedItem.call(
      this,
      `_:${templateId}`,
      {
        store
      }
    );

    if (!resolvedItem) {
      throw createError(
        400,
        `Resolver could not resolve cnode ${cnodeTemplateId}`
      );
    }

    return createId('cnode', uuid, resolvedItem)['@id'];
  }

  return cnodeTemplateId;
}
