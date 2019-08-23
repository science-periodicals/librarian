import pick from 'lodash/pick';
import omit from 'lodash/omit';
import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import schema from '../utils/schema';
import createId from '../create-id';
import getScopeId from '../utils/get-scope-id';
import { ensureAgentCompliance, validateDateTimeDuration } from '../validators';
import setId from '../utils/set-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import { getObjectId } from '../utils/schema-utils';
import {
  getMetaActionParticipants,
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * How comments (staging discussion) works:
 * - user can create comments offline from the client in PotentialActionStatus (drafts)
 * - A comment can only be activated (`ActiveActionStatus`) online this is
 *   so the server can guarantee that no comments are activated _after_ the object
 *   has been completed
 * - Only ActiveComment are displayed to other users
 * - CommentActions must have a completeOn trigger of value `OnObjectCompletedActionStatus`
 *   this is so that we can display notificiation of active comments only in the dashboard
 *
 * Comment `object` must be an action part of the editorial workflow
 * and in `StagedActionStatus`.
 *
 * TODO use `recipient` to list the users (or roles) who were `@` mentioned
 * in the comment body `recipient` is reserved for that use case (and that
 * use case only)
 *
 * Note: we do not sync comment to Graph, no need to search graphs by comment actions
 */
export default async function handleCommentAction(
  action,
  { store, triggered, prevAction } = {}
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `${action['@type']} must have a valid object`);
  }

  const workflowAction = await this.get(objectId, {
    store,
    acl: false
  });

  if (!workflowAction || !schema.is(workflowAction, 'Action')) {
    throw createError(
      400,
      `${action['@type']} object must be an action (got ${
        workflowAction['@type']
      })`
    );
  }

  if (
    !triggered && // need to be relaxed for triggers
    workflowAction.actionStatus !== 'StagedActionStatus'
  ) {
    throw createError(
      400,
      `${action['@type']} object (${workflowAction['@type']}, ${getId(
        workflowAction
      )}) must be an action in StagedActionStatus (got ${
        workflowAction.actionStatus
      })`
    );
  }

  if (!triggered && action.completeOn !== 'OnObjectCompletedActionStatus') {
    throw createError(
      400,
      `${
        action['@type']
      } must have a completeOn trigger set to OnObjectCompletedActionStatus`
    );
  }

  const scopeId = getScopeId(workflowAction);

  const scope = await this.get(scopeId, {
    store,
    acl: false
  });

  const commentActionId = createId('action', getId(action), scope);

  // validate the selector
  const selector = action.object.hasSelector;
  if (selector) {
    // if specified `node` must be equal to `objectId`
    if (selector.node) {
      if (getId(selector.node) !== objectId) {
        throw createError(
          400,
          `${
            action['@type']
          } must have a valid selector where node must point to ${objectId}`
        );
      }
    }

    // if specified `graph` must have the same scope as `scopeId`
    if (selector.graph) {
      if (getScopeId(selector.graph) !== scopeId) {
        throw createError(
          400,
          `${
            action['@type']
          } must have a valid selector where graph has the same scope as ${scopeId}`
        );
      }
    }
  }

  // validate `resultComment`
  if (
    !action.resultComment ||
    (action.resultComment['@type'] !== 'Comment' &&
      action.resultComment['@type'] !== 'EndorserComment') ||
    !action.resultComment.text
  ) {
    throw createError(
      400,
      `Invalid ${
        action['@type']
      }, resultComment must have at least a text and @type (set to Comment or EndorserComment) property defined`
    );
  }

  const messages = validateDateTimeDuration(action.resultComment);
  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  let resultCommentId = getId(action.resultComment);
  // validate and set `resultComment` @id
  if (resultCommentId) {
    const validId = createId(
      'cnode',
      getId(prevAction && prevAction.resultComment) || resultCommentId,
      commentActionId
    )['@id'];

    if (resultCommentId !== validId) {
      throw createError(
        400,
        `${
          action['@type']
        } invalid @id for resultComment expected ${validId} (got ${resultCommentId})`
      );
    }
  } else {
    resultCommentId = createId(
      'cnode',
      getId(prevAction && prevAction.resultComment) ||
        getId(action.resultComment),
      commentActionId
    )['@id'];
  }

  // We do comment "thread" by having a comment made in response to another
  // comment point to that parent comment using the `parentItem` prop of the
  // `resultComment`.

  // get the `parentItem` `@id` (if any)
  const parentItemId =
    getId(
      prevAction &&
        prevAction.resultComment &&
        prevAction.resultComment.parentItem
    ) ||
    getId(action && action.resultComment && action.resultComment.parentItem);

  if (parentItemId != null) {
    const parentItemCommentAction = await this.getEmbedderByEmbeddedId(
      parentItemId,
      {
        store
      }
    );
    const parentItem =
      parentItemCommentAction && parentItemCommentAction.resultComment;

    if (!parentItem || parentItemCommentAction['@type'] !== 'CommentAction') {
      throw createError(
        400,
        `${
          action['@type']
        } must have a valid resultComment.parentItem pointing to the @id of a resultComment of a CommentAction`
      );
    }

    // validate that the parentItem is in the same scope
    if (getScopeId(parentItemCommentAction) !== scopeId) {
      throw createError(
        400,
        `${
          action['@type']
        } must have a valid resultComment.parentItem pointing to the @id of a resultComment of a CommentAction of scope ${scopeId} (got ${getScopeId(
          parentItemCommentAction
        )})`
      );
    }
  }

  // result comment @type cannot be changed
  if (
    prevAction &&
    prevAction.resultComment['@type'] !== action.resultComment['@type']
  ) {
    throw createError(
      400,
      `${action['@type']} resultComment @type cannot be changed from ${
        prevAction.resultComment['@type']
      } (got ${action.resultComment['@type']})`
    );
  }

  // TODO extract @mention from the `text` prop of the resulting Comment and set `recipient`

  // TODO extract location from the `text` prop (string of the form "#0.1:1.2.3") of the resulting Comment and set `resultComment.about`

  // validate / force set `agent` and `participant`
  let agent;
  try {
    agent = ensureAgentCompliance(action.agent, scope, {
      ignoreEndDateOnPublicationOrRejection: true
    });
  } catch (err) {
    throw err;
  }

  // Get the workflow action audience
  // !! the audience of the workflow action can change when the action is
  // completed or endorsed
  // The audience of the comment action is the audience of the staged workflow
  // action (not more)
  let participants;
  if (workflowAction.actionStatus === 'StagedActionStatus') {
    participants = getMetaActionParticipants(workflowAction, {
      addAgent: getId(agent) !== getId(workflowAction.agent),
      restrictToActiveAndStagedAudiences: true
    });
  } else if (prevAction && prevAction.participant) {
    participants = arrayify(prevAction.participant);
  }

  const now = getActionStatusTime(action) || new Date().toISOString();

  const handledAction = setId(
    handleUserReferences(
      handleParticipants(
        setDefaultActionStatusTime(
          Object.assign(
            {
              '@type': 'CommentAction',
              actionStatus: 'ActiveActionStatus'
            },
            omit(action, ['potentialAction']),
            agent ? { agent } : undefined,
            participants && participants.length
              ? { participant: participants }
              : undefined,
            // if there is a prevAction, overwrite immutable props
            pick(prevAction, [
              '@id',
              '@type',
              '_id',
              '_rev',
              'startTime',
              'instrument',
              'object',
              'endTime',
              'agent'
            ]),
            {
              resultComment: setId(
                Object.assign(
                  {
                    '@type': 'Comment',
                    dateCreated: new Date().toISOString()
                  },
                  prevAction ? prevAction.resultComment : undefined, // we know that prevAction.resultComment is an Object and that it is defined as we validated it previously
                  action.resultComment, // we know it's an Object has we validated it above
                  // set `parentItem` in case of comment thread
                  parentItemId != null
                    ? {
                        parentItem: parentItemId
                      }
                    : undefined
                ),
                resultCommentId
              )
            }
          ),
          now
        ),
        scope,
        now
      ),
      scope
    ),
    commentActionId
  );

  const savedAction = await this.put(handledAction, {
    store,
    force: true
  });

  return savedAction;
}
