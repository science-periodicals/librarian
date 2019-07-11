import isPlainObject from 'lodash/isPlainObject';
import pick from 'lodash/pick';
import { getId, arrayify, dearrayify, unrole } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import {
  getInstantiatedAction,
  getFramedGraphTemplate,
  getWorkflowMap
} from '../utils/workflow-actions';
import { getObjectId, getResultId } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import createId from '../create-id';
import { validateDateTimeDuration } from '../validators';
import { parseRoleIds } from '../utils/role-utils';
/**
 * - Make `action` safe and compliant with the workflow
 * In particular, be sure that the actionStatus is set to the right value in case of Endorsement
 * See also `librarian#ensureServiceCompliance`
 */
export default async function ensureWorkflowCompliance(
  action,
  prevAction,
  graph, // live graph
  { store, triggered, now = new Date().toISOString() } = {}
) {
  if (triggered) {
    return action;
  }

  // Ensure that all the docs required for triggers are present before proceeding further
  await this.ensureAllWorkflowActionsStateMachineStatus(getId(graph), {
    store
  });

  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!sourceAgent) {
    const { roleId, userId } = parseRoleIds(action.agent);
    throw createError(
      400,
      `Invalid agent for ${getId(action)} ${action['@type']}, agent ${roleId ||
        userId ||
        action.agent.roleName} could not be found in the Graph (${getId(
        graph
      )})`
    );
  }

  const workflowSpecificationId = getId(graph && graph.workflow);
  if (!workflowSpecificationId) {
    throw createError(
      400,
      'Graph must have a workflow property pointing to a WorkflowSpecification'
    );
  }

  // There must be a prevAction as workflow action are only instantiated by
  // WorkflowSpecification and stage instantiation
  if (!prevAction) {
    throw createError(
      403,
      `User cannot create ${action['@type']} (@id:${getId(
        action
      )}, object:${getObjectId(
        action
      )}) as the Graph is part of a submission workflow (no previous action was found)`
    );
  }

  // ensure object integrity so that user cannot post with the wrong version
  if (getObjectId(prevAction) !== getObjectId(action)) {
    throw createError(
      400,
      `Invalid object for ${action['@type']} (${getId(action)}) ${getObjectId(
        action
      )} should be ${getObjectId(prevAction)}`
    );
  }

  const actionTemplateId = getId(action.instanceOf);
  if (!actionTemplateId) {
    throw createError(
      400,
      'Invalid action, action should have a instanceOf property pointing to an action template'
    );
  }

  const instantiatedStageId = getId(action.resultOf);
  if (!instantiatedStageId) {
    throw createError(
      400,
      'Invalid action, action should have a resultOf property pointing to a valid workflow stage'
    );
  }

  const docs = await this.get([workflowSpecificationId, instantiatedStageId], {
    store,
    acl: false
  });

  const workflowSpecification = docs.find(
    doc => getId(doc) === workflowSpecificationId
  );
  const createGraphAction = arrayify(
    workflowSpecification.potentialAction
  ).find(action => action['@type'] === 'CreateGraphAction');

  const instantiatedStage = docs.find(
    doc => getId(doc) === instantiatedStageId
  );

  if (!createGraphAction) {
    throw createError(
      400,
      'Graph must have a workflow property pointing to a WorkflowSpecification'
    );
  }

  if (!instantiatedStage) {
    throw createError(
      400,
      'Action resultOf property must points to a valid workflow stage'
    );
  }

  // handle `activateOn`
  if (
    prevAction.activateOn &&
    (action.actionStatus === 'ActiveActionStatus' ||
      action.actionStatus === 'EndorsedActionStatus' ||
      action.actionStatus === 'StagedActionStatus' ||
      action.actionStatus === 'CompletedActionStatus')
  ) {
    throw createError(
      400,
      `${getId(action)} (${action['@type']}) actionStatus cannot be set to ${
        action.actionStatus
      } given the activateOn property. The action will be activated based on the trigger (${
        prevAction.activateOn
      })`
    );
  }

  // handle `completeOn`
  if (
    prevAction.completeOn &&
    action.actionStatus === 'CompletedActionStatus' &&
    // escape hatch: endorse action set actionStatus to `EndorsedActionStatus`
    // but if the endorsed action has a completeOn: `OnEndorsed` trigger and that
    // this trigger fails, we need to relax the check so that we allow user to
    // post the triggered action in `CompletedActionStatus`
    !(
      prevAction.completeOn === 'OnEndorsed' &&
      prevAction.actionStatus === 'EndorsedActionStatus'
    )
  ) {
    throw createError(
      400,
      `${getId(action)} (${action['@type']}) actionStatus cannot be set to ${
        action.actionStatus
      } given the completeOn property. The action will be completed based on the trigger (${
        prevAction.completeOn
      })`
    );
  }

  // handle `endorseOn` and EndorsedActionStatus
  // Note: we allow PayAction with a paymentToken (or a price of 0) and no
  // requestedPrice (or a requestedPrice >= price) to bypass the EndorseAction
  // and go directly to  CompletedActionStatus stage
  if (
    (prevAction.endorseOn &&
      (action.actionStatus === 'EndorsedActionStatus' ||
        (action.actionStatus === 'CompletedActionStatus' &&
          !(
            action['@type'] === 'PayAction' &&
            (action.paymentToken ||
              action.priceSpecification == null ||
              action.priceSpecification.price === 0) &&
            (action.requestedPrice == null ||
              action.requestedPrice >= action.priceSpecification.price)
          )))) ||
    (prevAction.actionStatus !== 'EndorsedActionStatus' &&
      action.actionStatus === 'EndorsedActionStatus')
  ) {
    throw createError(
      400,
      `${getId(action)} (${action['@type']}) actionStatus cannot be set to ${
        action.actionStatus
      }. An EndorseAction must be issued instead`
    );
  }

  // handle `requiresCompletionOf`
  // An action cannot be completed or staged if all the required action have not been completed (or canceled)
  if (
    (prevAction.actionStatus !== 'CompletedActionStatus' &&
      action.actionStatus === 'CompletedActionStatus') ||
    (prevAction.actionStatus !== 'StagedActionStatus' &&
      action.actionStatus === 'StagedActionStatus')
  ) {
    const requiredActions = await this.get(
      arrayify(action.requiresCompletionOf),
      { store, acl: false }
    );

    const incompleteBlockingActions = requiredActions.filter(
      action =>
        action['@type'] !== 'EndorseAction' && // TODO that should no longer be needed (Endorse Action should never be listed as requiresCompletionOf)
        action.actionStatus !== 'CompletedActionStatus' &&
        action.actionStatus !== 'CanceledActionStatus'
    );

    // Action cannot be completed or staged if there are incompleteBlockingActions
    if (incompleteBlockingActions.length) {
      throw createError(
        403,
        `${getId(action)} (${action['@type']}) cannot be set as ${
          action.actionStatus
        } as some actions part of the workflow have not been completed:
                      ${incompleteBlockingActions
                        .map(action => `${action['@id']} (${action['@type']})`)
                        .join(', ')}.`
      );
    }
  }

  const framedGraphTemplate = await getFramedGraphTemplate(
    workflowSpecification
  );
  const workflowMap = getWorkflowMap(framedGraphTemplate);

  const actionTemplate = workflowMap[actionTemplateId];
  if (!actionTemplate) {
    throw createError(
      400,
      'Action instanceOf property must points to a valid template (could not be found in the CreateGraphAction)'
    );
  }

  const stageTemplate = workflowMap[getId(instantiatedStage.instanceOf)];
  if (!stageTemplate) {
    throw createError(
      400,
      'Action resultOf property must points to a valid workflow stage (could not be found in the CreateGraphAction)'
    );
  }

  if (
    actionTemplate.agent &&
    ((actionTemplate.agent.roleName &&
      actionTemplate.agent.roleName !== sourceAgent.roleName) ||
      (actionTemplate.agent.name &&
        actionTemplate.agent.name !== sourceAgent.name))
  ) {
    throw createError(
      400,
      `Agent of ${
        action['@type']
      } is not compliant with the definition of the action template`
    );
  }

  // Make `action` safe:
  // Only `agent`, `result`, `resultReview`, `scheduledTime`, `instrument`, `requestedPrice`, and
  // `actionStatus` can be set by the user we overwrite every other prop with the
  // value from the template
  // Note: finer grained validation may be performed by the specific action handlers,
  // for instance, for ReviewAction, questions part of `answer` cannot be mutated.
  action = Object.assign(
    {},
    prevAction, // `prevAction` and not `actionTemplate` as `prevAction` was safe by construction and may have other accumulated other changes (of valid prop) through time
    pick(
      action,
      prevAction.actionStatus === 'EndorsedActionStatus' // if it's endorsed it's immutable
        ? ['actionStatus', 'scheduledTime', 'paymentToken']
        : [
            'actionStatus',
            'requestedPrice',
            'answer',
            'result',
            'resultReview',
            'resultComment',
            'resultReason',
            'scheduledTime',
            'revisionType',
            'releaseNotes',
            'comment',
            'annotation',
            'paymentToken'
          ].concat(
            action['@type'] === 'CreateReleaseAction' ||
              action['@type'] === 'AssessAction' ||
              action['@type'] === 'ReviewAction'
              ? []
              : 'instrument'
          )
    ),
    {
      agent: remapRole(sourceAgent, 'agent')
    }
  );

  // validate revisionType
  const validRevisionTypes = [
    'PatchRevision',
    'MinorRevision',
    'MajorRevision'
  ];
  if (
    action.revisionType &&
    !validRevisionTypes.includes(action.revisionType)
  ) {
    throw createError(
      400,
      `invalid revisionType for ${
        action['@type']
      } (expected one of ${validRevisionTypes.join(', ')}, got ${
        action.revisionType
      })`
    );
  }

  if (
    action['@type'] === 'CreateReleaseAction' ||
    action['@type'] === 'PublishAction'
  ) {
    // Special case for CreateReleaseAction and PublishAction as action.result `@id`, `@type` and `version` were set during instantiation
    // => we backport them (if missing) and ensure that they can't be mutated
    // we create a shallow copy of `action.result` as we will mutate it
    action.result = Object.assign(
      {},
      typeof action.result === 'string'
        ? { '@id': action.result }
        : action.result
    );
    // backport immutable values
    ['@id', '@type', 'version'].forEach(p => {
      if (p in action.result) {
        if (prevAction.result[p] !== action.result[p]) {
          throw createError(
            403,
            `${action['@type']}, result property ${p} cannot be mutated`
          );
        }
      } else {
        action.result[p] = prevAction.result[p];
      }
    });
  }

  // validate and set @id to `comment` and `annotation` of `ReviewAction`,
  // `AssessAction` or `CreateReleaseAction`

  if (action.comment) {
    // validate
    for (const comment of arrayify(action.comment)) {
      // validate '@type' and dates
      if (action['@type'] === 'CreateReleaseAction') {
        if (comment['@type'] !== 'AuthorResponseComment') {
          throw createError(
            400,
            `${
              action['@type']
            } comment must have a type of AuthorResponseComment (got ${
              comment['@type']
            })`
          );
        }
      } else if (action['@type'] === 'AssessAction') {
        if (comment['@type'] !== 'RevisionRequestComment') {
          throw createError(
            400,
            `${
              action['@type']
            } comment must have a type of RevisionRequestComment (got ${
              comment['@type']
            })`
          );
        }
      } else if (action['@type'] === 'ReviewAction') {
        if (comment['@type'] !== 'ReviewerComment') {
          throw createError(
            400,
            `${
              action['@type']
            } comment must have a type of ReviewerComment (got ${
              comment['@type']
            })`
          );
        }
      }

      const messages = validateDateTimeDuration(comment);
      if (messages.length) {
        throw createError(400, messages.join(' '));
      }
    }

    // validate @ids and set dateCreated
    const commentIds = arrayify(action.comment)
      .map(getId)
      .filter(Boolean);
    if (commentIds.length !== new Set(commentIds).size) {
      throw createError(
        400,
        `${
          action['@type']
        } comments must all have unique @id (duplicate @id found)`
      );
    }

    if (
      commentIds.some(id => {
        return id !== createId('cnode', id, action)['@id'];
      })
    ) {
      throw createError(
        400,
        `${action['@type']} comments must be compliant with cnode: CURIE prefix`
      );
    }

    // TODO validate parentItems

    action.comment = dearrayify(
      action.comment,
      arrayify(action.comment).map(comment => {
        if (isPlainObject(comment)) {
          return Object.assign(
            { '@type': 'Comment', dateCreated: now },
            comment,
            createId('cnode', comment, action)
          );
        }
        return comment;
      })
    );
  }

  // validate and set @id to Annotation and annotationBody
  if (action.annotation) {
    let validAnnotationTargetId;
    if (action['@type'] === 'CreateReleaseAction' && getId(action.instrument)) {
      const assessAction = await this.get(getId(action.instrument), {
        acl: false,
        store
      });

      validAnnotationTargetId = getObjectId(assessAction);
    } else {
      validAnnotationTargetId =
        action['@type'] === 'CreateReleaseAction'
          ? getResultId(action)
          : getObjectId(action);
    }

    // validate
    for (const annotation of arrayify(action.annotation)) {
      // validate annotationBody['@type'] and dates
      const body = annotation.annotationBody;
      if (body) {
        if (action['@type'] === 'CreateReleaseAction') {
          if (body['@type'] !== 'AuthorResponseComment') {
            throw createError(
              400,
              `${
                action['@type']
              } annotation annotationBody must have a type of AuthorResponseComment (got ${
                body['@type']
              })`
            );
          }
        } else if (action['@type'] === 'AssessAction') {
          if (body['@type'] !== 'RevisionRequestComment') {
            throw createError(
              400,
              `${
                action['@type']
              } annotation annotationBody must have a type of RevisionRequestComment (got ${
                body['@type']
              })`
            );
          }
        } else if (action['@type'] === 'ReviewAction') {
          if (body['@type'] !== 'ReviewerComment') {
            throw createError(
              400,
              `${
                action['@type']
              } annotation annotationBody must have a type of ReviewerComment (got ${
                body['@type']
              })`
            );
          }
        }

        const messages = validateDateTimeDuration(body);
        if (messages.length) {
          throw createError(400, messages.join(' '));
        }
      }

      // validate target
      const target = annotation.annotationTarget;
      if (target) {
        const targetId = getId(unrole(target, 'annotationTarget'));
        if (targetId && targetId !== validAnnotationTargetId) {
          throw createError(
            400,
            `${
              action['@type']
            } annotation must have a valid annotationTarget pointing to ${validAnnotationTargetId}} (got ${targetId})`
          );
        }

        if (target.hasSelector) {
          const selector = target.hasSelector;

          // if specified `graph` must be `validAnnotationTargetId`
          if (selector.graph) {
            if (getId(selector.graph) !== validAnnotationTargetId) {
              throw createError(
                400,
                `${
                  action['@type']
                } annotation must have a valid selector where graph is ${validAnnotationTargetId}} (got ${getId(
                  selector.graph
                )})`
              );
            }
          }
        }
      }
    }

    // validate annotation @id and annotationBody @id
    const ids = arrayify(action.annotation)
      .map(getId)
      .concat(
        arrayify(action.annotation).map(annotation =>
          getId(annotation.annotationBody)
        )
      )
      .filter(Boolean);

    if (ids.length !== new Set(ids).size) {
      throw createError(
        400,
        `${
          action['@type']
        } annotation and annotation body must all have unique @id (duplicate @id found)`
      );
    }

    if (
      ids.some(id => {
        return id !== createId('cnode', id, action)['@id'];
      })
    ) {
      throw createError(
        400,
        `${
          action['@type']
        } annotations and their body must be compliant with cnode: CURIE prefix`
      );
    }

    // TODO validate parentItems

    // set @id
    action.annotation = dearrayify(
      action.annotation,
      arrayify(action.annotation).map(annotation => {
        if (isPlainObject(annotation)) {
          let sanitizedAnnotationTarget;

          if (annotation.annotationTarget) {
            if (typeof annotation.annotationTarget === 'string') {
              sanitizedAnnotationTarget = validAnnotationTargetId;
            } else if (isPlainObject(annotation.annotationTarget)) {
              if (annotation.annotationTarget.annotationTarget) {
                sanitizedAnnotationTarget = Object.assign(
                  {},
                  annotation.annotationTarget,
                  { annotationTarget: validAnnotationTargetId }
                );
              } else {
                sanitizedAnnotationTarget = Object.assign(
                  {},
                  annotation.annotationTarget,
                  { '@id': validAnnotationTargetId }
                );
              }
            }
          }

          return Object.assign(
            { '@type': 'Annotation' },
            annotation,
            createId('cnode', annotation, action),
            sanitizedAnnotationTarget
              ? { annotationTarget: sanitizedAnnotationTarget }
              : undefined,
            isPlainObject(annotation.annotationBody)
              ? {
                  annotationBody: Object.assign(
                    { dateCreated: now },
                    annotation.annotationBody,
                    createId('cnode', annotation.annotationBody, action)
                  )
                }
              : undefined
          );
        }

        return annotation;
      })
    );
  }

  // Prevent operations on potential action of CreateReleaseAction if
  // CreateReleaseAction hasn't been completed yet check that action is in the
  // instantiated stage
  const instantiatedActionInStage = getInstantiatedAction(
    action,
    instantiatedStage
  );
  if (!instantiatedActionInStage) {
    throw createError(
      400,
      'Action cannot be found in the instantiated workflow stage'
    );
  }

  let createReleaseAction = arrayify(instantiatedStage.result).find(
    result => result['@type'] === 'CreateReleaseAction'
  );
  if (
    createReleaseAction &&
    createReleaseAction.result &&
    arrayify(createReleaseAction.result.potentialAction).some(
      _action => getId(_action) === getId(action)
    )
  ) {
    createReleaseAction = await this.get(createReleaseAction, {
      acl: false,
      store
    });

    if (createReleaseAction.actionStatus !== 'CompletedActionStatus') {
      throw createError(
        403,
        `${
          action['@type']
        } cannot be completed as the instrument CreateReleaseAction ${getId(
          createReleaseAction
        )} haven't been completed yet (${
          createReleaseAction.actionStatus
        }). Try again once the CreateReleaseAction has been completed`
      );
    }
  }

  return action;
}
