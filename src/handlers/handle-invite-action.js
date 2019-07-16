import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, unprefix, arrayify, dearrayify } from '@scipe/jsonld';
import {
  getObjectId,
  getRootPartId,
  getAgentId,
  getAgent
} from '../utils/schema-utils';
import { parseRoleIds } from '../utils/role-utils';
import { isRole } from '../validators';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import remapRole from '../utils/remap-role';
import findRole from '../utils/find-role';
import setId from '../utils/set-id';
import { ALL_AUDIENCES } from '../constants';
import { isActionAssigned } from '../acl';

/**
 * Invite a recipient to a Graph, Periodical or Organization
 *
 * In case of invite to Periodical, the recipient can be made admin
 * by setting an AdminPermission as instrument
 *
 * A `purpose` can be set to a workflow action (eg. invite a new
 * reviewer to do a ReviewAction) and is validated here.
 *
 * Note: Completing the action and eventually adding the recipient
 * to the Graph, Periodical etc. is done in the AcceptAction and
 * RejectAction handlers
 */
export default async function handleInviteAction(
  action,
  { store, triggered, prevAction, strict = true } = {}
) {
  if (action.actionStatus === 'CompletedActionStatus') {
    throw createError(
      403,
      `${
        action['@type']
      } cannot be completed, issue an AcceptAction or RejectAction instead`
    );
  }

  // Some props are immutable
  if (prevAction) {
    action = Object.assign(
      {},
      action,
      pick(prevAction, [
        'agent',
        'recipient',
        'instrument',
        'startTime',
        'object'
      ])
    );
  }

  // get and validate object
  const object = await this.get(getObjectId(action), {
    store,
    acl: false
  });

  if (
    !object ||
    (object['@type'] !== 'Graph' &&
      object['@type'] !== 'Periodical' &&
      object['@type'] !== 'Organization') ||
    object.version != null
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } must have an object pointing to a Graph, Periodical, or Organization`
    );
  }

  // validate agent;
  const sourceAgent = findRole(action.agent, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  // For Graphs, the agent must be a Role (so that we can preserve anonymity)
  if (!sourceAgent && object['@type'] === 'Graph') {
    throw createError(
      400,
      `${action['@type']} agent must be a valid ${object['@type']} (${getId(
        object
      )}) Role`
    );
  }

  const handledAgent = sourceAgent
    ? remapRole(sourceAgent, 'agent', { dates: false })
    : getAgentId(action.agent);

  // validate recipient
  const handledRecipient = await this.resolveRecipients(
    action.recipient,
    object,
    { store, strict }
  );

  // recipient must be a role
  if (
    !isRole(handledRecipient, 'recipient', {
      needRoleProp: true,
      objectType: object['@type']
    })
  ) {
    throw createError(400, `${action['@type']} recipient must be a valid Role`);
  }

  const { userId } = parseRoleIds(handledRecipient);
  let email;
  if (!userId) {
    email = getAgent(handledRecipient).email;
  }

  // Check that recipient is not already part of object
  // Note: we allow to add several editor or producer roles as long as they have different subtitle
  const existingRole = findRole(handledRecipient, object, {
    ignoreEndDateOnPublicationOrRejection: true
  });

  if (
    existingRole &&
    ((existingRole.name && existingRole.name === handledRecipient.name) ||
      (existingRole.roleName === handledRecipient.roleName &&
        existingRole.roleName !== 'editor' &&
        existingRole.roleName !== 'producer'))
  ) {
    throw createError(
      400,
      `Invalid recipient for the ${
        action['@type']
      }. Recipient (${userId}) is already listed in the ${
        object['@type']
      } (${getId(existingRole)} ${existingRole.name || existingRole.roleName})`
    );
  }

  // when adding a producer or editor to a Graph additional restrictions applies
  if (object['@type'] === 'Graph') {
    if (
      handledRecipient.roleName === 'editor' ||
      handledRecipient.roleName === 'producer'
    ) {
      const journal = await this.get(getRootPartId(object), {
        acl: false,
        store
      });

      // we make sure that he is listed in the Periodical
      if (
        !findRole(handledRecipient, journal, {
          ignoreEndDateOnPublicationOrRejection: true
        })
      ) {
        throw createError(
          400,
          `Invalid recipient for the ${action['@type']}. Recipient (${userId ||
            unprefix(email)}) must be listed in the Periodical ${
            handledRecipient.roleName
          }s`
        );
      }
    }

    // In case where we invite a journal role (including reviewers) to a graph,
    // we can set the graph role @id (different from the journal role @id) through
    // the sameAs property
    // Here we replicate the recipient @id by the sameAs
    // Note: this must be done after validation
    if (!strict) {
      if (
        action.recipient &&
        getId(action.recipient.sameAs) &&
        getId(action.recipient.sameAs).startsWith('role:')
      ) {
        handledRecipient['@id'] = getId(action.recipient.sameAs);
      }
    }
  }

  // validate `instrument` (if any)
  // `instrument` is used to specify an AdminPermission (only for journals)
  if (action.instrument) {
    if (object['@type'] !== 'Periodical') {
      throw createError(
        403,
        `${action['@type']} toward ${
          object['@type']
        } cannot have an instrument property}`
      );
    }
    const instrument = arrayify(action.instrument)[0];
    if (
      instrument.permissionType !== 'AdminPermission' ||
      (userId && getId(instrument.grantee) !== userId) ||
      (!userId &&
        email &&
        (!instrument.grantee || instrument.grantee.email !== email))
    ) {
      throw createError(403, `Invalid instrument for ${action['@type']}`);
    }
  }

  // validate `purpose` (if any)
  // `purpose` must list valid _unassigned_ workflow actions
  if (arrayify(action.purpose).length) {
    if (object['@type'] !== 'Graph') {
      throw createError(
        400,
        `${
          action['@type']
        } purpose can only be specified if the object of the ${
          action['@type']
        } is a Graph (got ${object['@type']})`
      );
    }

    // Ensure that all the docs required  are present before proceeding further
    await this.ensureAllWorkflowActionsStateMachineStatus(getId(object), {
      store
    });

    const purposeIds = arrayify(action.purpose)
      .map(getId)
      .filter(Boolean);

    if (purposeIds.length !== arrayify(action.purpose).length) {
      throw createError(
        400,
        `${
          action['@type']
        }: invalid "purpose" value, "purpose" must point to unassigned workflow action @ids`
      );
    }

    const purposes = await this.get(purposeIds, {
      acl: false,
      store
    });
    if (purposes.length !== arrayify(action.purpose).length) {
      throw createError(
        400,
        `${
          action['@type']
        }: invalid "purpose" value, some  @id could not be found (${purposes
          .map(getId)
          .join(',')} vs ${purposeIds.join(', ')})`
      );
    }

    const validTypes = new Set([
      'CreateReleaseAction',
      'AssessAction',
      'DeclareAction',
      'ReviewAction',
      'PayAction',
      'TypesettingAction', // TODO may need extra validation for `TypesettingAction` in case of brokered services
      'PublishAction'
    ]);

    if (
      purposes.some(
        action => !validTypes.has(action['@type'] || isActionAssigned(action))
      )
    ) {
      throw createError(
        400,
        `${
          action['@type']
        }: invalid "purpose" value, "purpose" must point to unassigned workflow actions`
      );
    }

    // check that the invite recipient is role compatible with the agent of the workflow action template
    for (const purpose of purposes) {
      const template = await this.getActionTemplateByTemplateId(
        getId(purpose.instanceOf),
        { store }
      );

      if (
        template.agent &&
        template.agent.roleName &&
        (template.agent.roleName !== handledRecipient.roleName ||
          (template.agent.name &&
            template.agent.name !== handledRecipient.name))
      ) {
        throw createError(
          400,
          `${action['@type']}: invalid "purpose" value ${getId(
            purpose
          )}, "purpose" must point to unassigned workflow actions whose agent is compatible with the workflow action specification (${[
            template.agent.roleName,
            template.agent.name
          ]
            .filter(Boolean)
            .join(', ')})`
        );
      }
    }

    // Ensure that there are no other ongoing invites for the same purpose
    // Note that we already have a global lock on the purpose thanks to
    // librarian#createWorkflowActionLock
    // Note: !!! the same check must be used in the AssignAction handler
    // Note: the `getActiveInviteActionsByPurposeId` is safe wrt CouchDB 2.x /
    // eventual consistency as we preloaded the store with `ensureAllWorkflowActionsStateMachineStatus`
    // upstream
    const otherActiveInviteActions = await this.getActiveInviteActionsByPurposeId(
      purposeIds,
      { store }
    );
    if (
      otherActiveInviteActions.some(
        inviteAction => getId(inviteAction) !== getId(action)
      )
    ) {
      throw createError(
        423,
        `An ActiveInviteAction with the same purpose already exists`
      );
    }
  }

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          // set default audience to every role so that user see the active invites
          participant: ALL_AUDIENCES
        },
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
          agent: handledAgent,
          recipient: handledRecipient
        },
        action.purpose
          ? {
              purpose: dearrayify(
                action.purpose,
                arrayify(action.purpose).map(getId)
              )
            }
          : undefined
      ),
      object
    ),
    createId('action', action, object)
  );

  const savedAction = await this.put(handledAction, {
    force: true,
    store
  });

  return savedAction;
}
