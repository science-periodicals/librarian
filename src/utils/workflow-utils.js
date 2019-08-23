import querystring from 'querystring';
import moment from 'moment';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import isEqual from 'lodash/isEqual';
import { arrayify, getId, getNodeMap, unrole } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import remapRole from '../utils/remap-role';
import { DEFAULT_PEER_REVIEW_TYPES } from '../constants';

export const WORKFLOW_ACTION_TYPES = new Set([
  'DeclareAction',
  'ReviewAction',
  'PayAction',
  'CreateReleaseAction',
  'AssessAction',
  'TypesettingAction',
  'EndorseAction',
  'PublishAction'
]);

/**
 * Infer the startTime of:
 * - a workflow action that's part of a substage (potential action of the result of a CreateReleaseAction)
 * - an endorse action that hasn't been activated yet
 */
export function inferStartTime(
  action = {},
  stage = {},
  { now = new Date().toISOString() } = {}
) {
  if (action.startTime) {
    return action.startTime;
  }

  if (action['@type'] === 'EndorseAction') {
    const stageActions = getStageActions(stage);
    const object = stageActions.find(
      object => getId(object) === getId(action.object)
    );
    if (object && object.startTime) {
      return (
        object.endTime ||
        moment(object.startTime)
          .add(moment.duration(object.expectedDuration))
          .toISOString()
      );
    }
  }

  const createReleaseAction = arrayify(stage.result).find(
    result => result['@type'] === 'CreateReleaseAction'
  );
  if (createReleaseAction && !createReleaseAction.endTime) {
    const graph = createReleaseAction.result;
    if (graph) {
      if (
        arrayify(graph.potentialAction).some(
          _action => getId(_action) === getId(action)
        )
      ) {
        return moment(createReleaseAction.startTime)
          .add(moment.duration(createReleaseAction.expectedDuration))
          .toISOString();
      }
    }
  }
}

export function getBlockingActions(action, stage = {}) {
  if (
    action.actionStatus === 'CompletedActionStatus' ||
    action.actionStatus === 'CanceledActionStatus' ||
    action.actionStatus === 'FailedActionStatus'
  ) {
    return [];
  }

  const stageActionMap = getNodeMap(getStageActions(stage));
  const blockingActions = arrayify(action.requiresCompletionOf)
    .map(id => stageActionMap[getId(id)])
    .filter(Boolean)
    .filter(
      action =>
        WORKFLOW_ACTION_TYPES.has(action['@type']) &&
        action.actionStatus !== 'CompletedActionStatus' &&
        action.actionStatus !== 'CanceledActionStatus' &&
        action.actionStatus !== 'FailedActionStatus'
    );

  // if action is not direct result of stage and is not an endorse action or a service action => action is result of the
  // potential action of a Graph (itself result of a CreateReleaseAction), we add
  // the top level action of the stage as blocking actions
  if (
    action['@type'] !== 'EndorseAction' &&
    // service actions
    action['@type'] !== 'TypesettingAction' &&
    !arrayify(stage.result).some(result => getId(result) === getId(action))
  ) {
    arrayify(stage.result).forEach(result => {
      if (
        WORKFLOW_ACTION_TYPES.has(result['@type']) &&
        result.actionStatus !== 'CompletedActionStatus' &&
        result.actionStatus !== 'CanceledActionStatus' &&
        result.actionStatus !== 'FailedActionStatus' &&
        !blockingActions.some(action => getId(action) === getId(result))
      ) {
        blockingActions.push(result);
      }
    });
  }

  return blockingActions;
}

/**
 * Get all workflow actions of a stage
 */
export function getStageActions(stage = {}) {
  let stageActions = [];

  arrayify(stage.result).forEach(action => {
    if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
      stageActions.push(action);

      // EndorseAction
      arrayify(action.potentialAction).forEach(action => {
        if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
          stageActions.push(action);
        }
      });
    }

    // CreateReleaseAction can contain serviceAction (TypesettingAction etc.)
    // _and_ other stage actions (in the potential action of the resulting graph)
    if (action['@type'] === 'CreateReleaseAction') {
      // Handle the service actions (and their endorsement)
      // get the BuyAction from the Stage. The BuyAction contain the service action as buyAction.result.orderedItem (see syncWorkflow method)
      arrayify(action.potentialService).forEach(service => {
        if (service.offers) {
          arrayify(service.offers.potentialAction).forEach(action => {
            if (action['@type'] === 'BuyAction') {
              const serviceAction = action.result && action.result.orderedItem;
              if (serviceAction) {
                if (WORKFLOW_ACTION_TYPES.has(serviceAction['@type'])) {
                  stageActions.push(serviceAction);

                  // EndorseAction
                  arrayify(serviceAction.potentialAction).forEach(action => {
                    if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
                      stageActions.push(action);
                    }
                  });
                }
              }
            }
          });
        }
      });

      const graph = action.result;
      if (graph) {
        arrayify(graph.potentialAction).forEach(action => {
          if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
            stageActions.push(action);

            // EndorseAction case
            arrayify(action.potentialAction).forEach(action => {
              if (WORKFLOW_ACTION_TYPES.has(action['@type'])) {
                stageActions.push(action);
              }
            });
          }
        });
      }
    }
  });

  return stageActions;
}

// TODO unify with `getActiveAudiences` in role-utils.js
export function getActiveAudience(
  action,
  { now = new Date().toISOString(), restrictToActiveAndStagedAudiences } = {}
) {
  return arrayify(action.participant)
    .filter(role => {
      const unroled = unrole(role, 'participant');
      return (
        unroled &&
        unroled.audienceType &&
        (!role.endDate || role.endDate > now) &&
        (!role.startDate ||
          (role.startDate <= now &&
            (!restrictToActiveAndStagedAudiences ||
              (restrictToActiveAndStagedAudiences &&
                (!action.stagedTime || role.startDate <= action.stagedTime)))))
      );
    })
    .map(participant =>
      pick(unrole(participant, 'participant'), ['@type', 'audienceType'])
    );
}

/**
 * Used to get the `participant` of action taking a workflow action as
 * `object` (e.g., ScheduleAction, AssignAction, UnassignAction, CancelAction, CommentAction)
 */
export function getMetaActionParticipants(
  action, // the action `object` of the "meta" action
  {
    now = new Date().toISOString(),
    addAgent = true, // if specified the agent of the `action` will be added (if not covered by the audiences)
    restrictToAuthorsAndProducers = false, // this is required for UploadAction and UpdateAction so that audience is only composed of user who can view the author identity
    restrictToActiveAndStagedAudiences = false // this is used for CommentAction
  } = {}
) {
  const participants = [];

  let activeAudiences = getActiveAudience(action, {
    now,
    restrictToActiveAndStagedAudiences
  });
  if (restrictToAuthorsAndProducers) {
    activeAudiences = activeAudiences.filter(
      audience =>
        audience.audienceType === 'author' ||
        audience.audienceType === 'producer'
    );
  }

  participants.push(...activeAudiences);

  if (
    addAgent &&
    action.agent &&
    action.agent.roleName &&
    (!restrictToAuthorsAndProducers ||
      (restrictToAuthorsAndProducers &&
        (action.agent.roleName === 'author' ||
          action.agent.roleName === 'producer'))) &&
    getId(action.agent) &&
    !activeAudiences.some(
      audience => audience.audienceType === action.agent.roleName
    )
  ) {
    participants.push(remapRole(action.agent, 'participant'));
  }

  return participants;
}

/**
 * This is used by app-suite to generate counters value
 * !! never change existing values (that would break permalinks) but append instead
 */
export function getActionOrder(action) {
  const type = action['@type'] || action;
  switch (type) {
    case 'CreateReleaseAction':
      return 1;
    case 'DeclareAction':
      return 2;
    case 'TypesettingAction':
      return 3;
    case 'ReviewAction':
      return 4;
    case 'PayAction':
      return 5;
    case 'AssessAction':
      return 6;
    case 'PublishAction':
      return 7;
    default:
      throw new createError(
        400,
        `Invalid action @type (${type}) for getActionOrder`
      );
  }
}

/**
 * This is used to generate the workflow action identifiers
 * Note: we try to avoid sorting by uuid so that sort is stable for stories
 */
export function compareActions(a, b) {
  // sort by action type
  const orderA = getActionOrder(a);
  const orderB = getActionOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  // or sort by action name
  const nameA = a.name || '';
  const nameB = b.name || '';
  if (nameA && nameB && nameA !== nameB) {
    return nameA.localeCompare(nameB);
  }

  // or sort by description
  const descriptionA = a.description || '';
  const descriptionB = b.description || '';
  if (descriptionA && descriptionB && descriptionA !== descriptionB) {
    return descriptionA.localeCompare(descriptionB);
  }

  // or sort by instance index
  if (
    getId(a.instanceOf) &&
    getId(b.instanceOf) &&
    getId(a.instanceOf) === getId(b.instanceOf) &&
    'instanceIndex' in a &&
    'instanceIndex' in b &&
    a.instanceIndex !== b.instanceIndex
  ) {
    return a.instanceIndex - b.instanceIndex;
  }

  // or sort by title
  const titleA =
    ((a.agent && a.agent.roleName) || '') + ((a.agent && a.agent.name) || '');
  const titleB =
    ((b.agent && b.agent.roleName) || '') + ((b.agent && b.agent.name) || '');
  if (titleA && titleB && titleA !== titleB) {
    return titleA.localeCompare(titleB);
  }

  // or sort by instance index
  if (
    getId(a.instanceOf) &&
    getId(b.instanceOf) &&
    getId(a.instanceOf) === getId(b.instanceOf) &&
    'instanceIndex' in a &&
    'instanceIndex' in b &&
    a.instanceIndex !== b.instanceIndex
  ) {
    return a.instanceIndex - b.instanceIndex;
  }

  // we run out of deterministic option, we fall back on UUID
  if (
    getId(a.instanceOf) &&
    getId(b.instanceOf) &&
    getId(a.instanceOf) !== getId(b.instanceOf)
  ) {
    return getId(a.instanceOf).localeCompare(getId(b.instanceOf));
  }

  // otherwise fall back to @id (always defined)
  return getId(a).localeCompare(getId(b));
}

/**
 * This is used by app-suite to generate counters value
 * !! never change existing values (that would break permalinks) but append instead
 */
export function getLocationIdentifier(
  type, // the `@type` of the action
  property = '' // can be a path like `resultReview.reviewBody`. If undefined only the `prefix` will be returned
) {
  let prefix;
  switch (type) {
    case 'CreateReleaseAction':
      prefix = 'u';
      break;
    case 'DeclareAction':
      prefix = 'd';
      break;
    case 'TypesettingAction':
      prefix = 't';
      break;
    case 'ReviewAction':
      prefix = 'r';
      break;
    case 'PayAction':
      prefix = 'c';
      break;
    case 'AssessAction':
      prefix = 'a';
      break;
    case 'PublishAction':
      prefix = 'p';
      break;
    default:
      throw new createError(
        400,
        `Invalid action @type (${type}) for getActionOrder`
      );
  }

  if (!property) {
    return prefix;
  }

  // Keep test-workflow-utils in sync when adding a property so that we ensure unicity
  // generated with first letter of the prop until clash and try best when clashes
  let suffix;
  switch (property) {
    case 'actionStatus':
      suffix = 'as';
      break;
    case 'description':
      suffix = 'de';
      break;
    case 'expectedDuration':
      suffix = 'ed';
      break;
    case 'encoding':
      suffix = 'en';
      break;
    case 'releaseNotes':
      suffix = 'rn';
      break;
    case 'programmingLanguage':
      suffix = 'pl';
      break;
    case 'isBasedOn':
      suffix = 'ib';
      break;
    case 'hasPart':
      suffix = 'hp';
      break;
    case 'comment':
      suffix = 'co';
      break;
    case 'text':
      suffix = 'te';
      break;
    case 'distribution':
      suffix = 'di';
      break;
    case 'result':
      suffix = 're';
      break;
    case 'object':
      suffix = 'ob';
      break;
    case 'revisionType':
      suffix = 'rt';
      break;
    case 'resultReason':
      suffix = 'rr';
      break;

    case 'result.slug':
    case 'slug': // shortcut (context should never matter as `slug` is not an action property)
      suffix = 'sl';
      break;

    case 'result.datePublished':
    case 'datePublished': // shortcut (context should never matter as `datePublished` is not an action property)
      suffix = 'dp';
      break;

    case 'requestedPrice':
      suffix = 'rp';
      break;
    case 'instrument':
      suffix = 'in';
      break;
    case 'question':
      suffix = 'qu';
      break;
    case 'annotation':
      suffix = 'an';
      break;
    case 'citation':
      suffix = 'ci';
      break;
    case 'about':
      suffix = 'ab';
      break;
    case 'license':
      suffix = 'li';
      break;
    case 'alternateName':
      suffix = 'ln';
      break;
    case 'caption':
      suffix = 'ca';
      break;

    case 'funder':
      suffix = 'fu';
      break;
    case 'headline':
      suffix = 'he';
      break;
    case 'detailedDescription':
      suffix = 'dd';
      break;
    case 'answer':
      suffix = 'aw';
      break;

    // !! context may matter for `parentItem`
    case 'parentItem':
      suffix = 'pi';
      break;
    case 'answer.parentItem':
      suffix = 'ap';
      break;
    case 'resultReview':
      suffix = 'er';
      break;

    // !! context may matter for `reviewRating`
    case 'reviewRating':
      suffix = 'vr';
      break;
    case 'resultReview.reviewRating':
      suffix = 'ra';
      break;

    // !! context may matter for `reviewBody`
    case 'reviewBody':
      suffix = 'rb';
      break;
    case 'resultReview.reviewBody':
      suffix = 'rv';
      break;

    case 'potentialAction':
      suffix = 'pa';
      break;

    default:
      throw new createError(
        400,
        `Invalid property (${property}) for getActionPropertyOrder`
      );
  }

  return `${prefix}${suffix.toUpperCase()}`;
}

export function isAgentSoleAudience(
  action = {},
  { now = new Date().toISOString() } = {}
) {
  if (!action.agent || !action.agent.roleName) return undefined;

  const activeAudienceTypes = arrayify(action.participant)
    .filter(role => {
      return (
        !role.participant ||
        !role.roleName ||
        ((!role.endDate || role.endDate > now) &&
          (!role.startDate || role.startDate <= now))
      );
    })
    .map(role => {
      return unrole(role, 'participant');
    })
    .filter(unroled => unroled.audienceType)
    .filter(Boolean);

  return !activeAudienceTypes.some(
    audienceType => audienceType === action.agent.roleName
  );
}

export function getVersion(id) {
  id = getId(id);
  if (id) {
    const qs = id.split('?')[1];
    if (qs) {
      return querystring.parse(qs).version;
    }
  }
}

export function addPublicAudience(
  action,
  { now = new Date().toISOString() } = {}
) {
  // update public audience (if any)
  const nextParticipants = arrayify(action.participant).map(role => {
    const unroled = unrole(role, 'participant');

    if (unroled && unroled.audienceType === 'public') {
      // if the audience will start later, update startDate
      if (role.startDate && role.startDate > now) {
        return Object.assign({}, role, { startDate: now });
      }

      // if the audience will expire but has not already expired, remove endDate
      if (role.endDate && role.endDate >= now) {
        return omit(role, ['endDate']);
      }
    }

    return role;
  });

  if (
    !nextParticipants.some(role => {
      const unroled = unrole(role, 'participant');
      return (
        unroled &&
        unroled.audienceType === 'public' &&
        (!role.startDate || role.startDate <= now) &&
        (!role.endDate || role.endDate >= now)
      );
    })
  ) {
    // `handleParticipants` will set @id etc.
    nextParticipants.push({
      '@type': 'AudienceRole',
      startDate: now,
      participant: {
        '@type': 'Audience',
        audienceType: 'public'
      }
    });
  }

  return Object.assign({}, action, { participant: nextParticipants });
}

export function getBlindingType(permissions = []) {
  const matrix = getViewIdentityPermissionMatrix(permissions);

  const type =
    Object.keys(DEFAULT_PEER_REVIEW_TYPES).find(peerReviewType => {
      return isEqual(
        matrix,
        getViewIdentityPermissionMatrix(
          DEFAULT_PEER_REVIEW_TYPES[peerReviewType].permissions
        )
      );
    }) || 'custom';

  return type;
}

function getViewIdentityPermissionMatrix(permissions) {
  // Note: this is computed _without_ the public audience as the public audience is typically added after acceptance
  const roleNames = ['editor', 'author', 'reviewer', 'producer'];

  return roleNames.map(rowRoleName => {
    const rowPermission = arrayify(permissions).find(permission => {
      return (
        permission.permissionType === 'ViewIdentityPermission' &&
        arrayify(permission.grantee).some(grantee => {
          return grantee.audienceType === rowRoleName;
        })
      );
    });
    const scopes = new Set(
      arrayify(rowPermission && rowPermission.permissionScope).map(
        permissionScope => {
          return permissionScope.audienceType;
        }
      )
    );

    return roleNames.map(columnRoleName => {
      return scopes.has(columnRoleName);
    });
  });
}

export function getActionStatusTime(action) {
  return action.actionStatus === 'ActiveActionStatus' && action.startTime
    ? action.startTime
    : action.actionStatus === 'StagedActionStatus' && action.stagedTime
    ? action.stagedTime
    : action.actionStatus === 'EndorsedActionStatus' && action.endorsedTime
    ? action.endorsedTime
    : (action.actionStatus === 'CompletedActionStatus' ||
        action.actionStatus === 'CanceledActionStatus' ||
        action.actionStatus === 'FailedActionStatus') &&
      action.endTime
    ? action.endTime
    : undefined;
}

export function setDefaultActionStatusTime(action, now) {
  return Object.assign(
    {},
    action.actionStatus !== 'PotentialActionStatus'
      ? {
          startTime: now
        }
      : undefined,
    action.actionStatus === 'StagedActionStatus'
      ? { stagedTime: now }
      : undefined,
    action.actionStatus === 'EndorsedActionStatus'
      ? { endorsedTime: now }
      : undefined,
    action.actionStatus === 'CompletedActionStatus' ||
      action.actionStatus === 'CanceledActionStatus' ||
      action.actionStatus === 'FailedActionStatus'
      ? {
          endTime: now
        }
      : undefined,
    action
  );
}
