import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { getId, arrayify, reUuid, unprefix } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import remapRole from '../../utils/remap-role';
import handleParticipants from '../../utils/handle-participants';
import setId from '../../utils/set-id';
import createId from '../../create-id';
import findRole from '../../utils/find-role';
import {
  getRootPartId,
  getObjectId,
  getAgentId
} from '../../utils/schema-utils';
import { isEqualDigitalDocumentPermission } from '../../acl';

/**
 * Used to accept an `InviteAction`  (the `object`)
 * Note: we know that the InviteAction is valid so we go straight to side effects
 * Side effects:
 *  - add recipient to the object of the invite action
 *  - assign actions listed as `purpose` of the invite action with the recipient of the invite action
 *  - re-generate the `participant` of all workflow actions so they list the invitee
 */
export default async function handleAcceptInviteAction(
  action,
  inviteAction,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (inviteAction.actionStatus !== 'ActiveActionStatus') {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }. object must be an InviteAction in ActiveActionStatus status (got ${
        inviteAction.actionStatus
      })`
    );
  }

  const object = await this.get(getObjectId(inviteAction), {
    store,
    acl: false
  });

  // Validate agent
  let agent = action.agent;
  // Note if we invite someone to a Graph, the agent may be the roleId of a Periodical
  // -> we resolve it here
  if (object['@type'] === 'Graph') {
    const periodicalId = getRootPartId(object);
    if (!periodicalId) {
      throw createError(
        400,
        `Invalid object for ${
          action['@type']
        }, object is not part of a Periodical`
      );
    }

    const periodical = await this.get(periodicalId, {
      store,
      acl: false
    });

    const periodicalRole = findRole(agent, periodical, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (periodicalRole) {
      // we replace recipient by a remaped periodical role if we find one
      agent = omit(remapRole(periodicalRole, 'agent', { dates: false }), [
        '_id',
        '_rev'
      ]);
    }
  }

  if (getAgentId(agent) !== getAgentId(inviteAction.recipient)) {
    throw createError(
      403,
      `Invalid agent for ${
        action['@type']
      }. Agent must be compatible with the invite action recipient`
    );
  }

  // if a role @id was set ahead of time we preserve it.
  // This is required for stories
  const roleId = getId(inviteAction.recipient);

  const roleProp =
    object['@type'] === 'Organization'
      ? 'member'
      : inviteAction.recipient.roleName;

  const addedRole = setId(
    Object.assign(
      {},
      remapRole(inviteAction.recipient, roleProp, {
        dates: false
      }),
      {
        startDate: new Date().toISOString()
      }
    ),
    createId(
      'role',
      roleId && roleId.startsWith('role:') && reUuid.test(unprefix(roleId))
        ? roleId
        : null
    )
  );

  const savedObject = await this.update(
    object,
    object => {
      const adminPermission = arrayify(inviteAction.instrument).find(
        instrument => instrument.permissionType === 'AdminPermission'
      );

      return Object.assign(
        {},
        object,
        {
          [roleProp]: arrayify(object[roleProp]).concat(
            findRole(inviteAction.recipient, object, {
              strict: true,
              ignoreEndDateOnPublicationOrRejection: true
            })
              ? [] // for whatever reason (for instance a JoinAction) the role was already added => noop
              : addedRole
          )
        },
        adminPermission
          ? {
              hasDigitalDocumentPermission: arrayify(
                object.hasDigitalDocumentPermission
              )
                .filter(
                  permission =>
                    !isEqualDigitalDocumentPermission(
                      permission,
                      adminPermission
                    )
                )
                .concat(adminPermission)
            }
          : undefined
      );
    },
    { store }
  );

  if (inviteAction.purpose) {
    // we assign the actions listed as purpose with the `addedRole`
    // Note that the role compatibility was already checked in the invite action handler
    const assignedRole = findRole(addedRole, savedObject, {
      active: false,
      ignoreEndDateOnPublicationOrRejection: true
    });
    const assignerRole = findRole(inviteAction.agent, savedObject, {
      active: false,
      ignoreEndDateOnPublicationOrRejection: true
    });

    const assignedActions = [];
    for (const purposeId of arrayify(inviteAction.purpose)) {
      const assignedAction = await this.update(
        purposeId,
        action => {
          return handleParticipants(
            Object.assign({}, action, {
              agent: remapRole(assignedRole, 'agent', { dates: false }),
              participant: arrayify(action.participant)
                .filter(
                  role =>
                    role.roleName !== 'assigner' &&
                    role.roleName !== 'unassigner'
                )
                .concat({
                  '@id': createId('srole', null, getId(assignerRole))['@id'],
                  roleName: 'assigner',
                  startDate: new Date().toISOString(),
                  participant: getAgentId(assignerRole)
                })
            }),
            savedObject
          );
        },
        { store }
      );

      assignedActions.push(assignedAction);
    }

    if (assignedActions.length) {
      try {
        await this.syncGraph(savedObject, assignedActions, { store });
      } catch (err) {
        this.log.error({ err, assignedActions }, 'error syncing graph');
      }

      try {
        await this.syncWorkflow(assignedActions, { store });
      } catch (err) {
        this.log.error({ err, assignedActions }, 'error syncing workflowStage');
      }
    }
  }

  const handledRecipient = findRole(addedRole, savedObject, {
    ignoreEndDateOnPublicationOrRejection: true
  })
    ? remapRole(addedRole, 'recipient', { dates: false })
    : inviteAction.recipient;

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(handledRecipient, 'agent', {
            dates: false
          }),
          result: getId(savedObject)
        }
      ),
      savedObject
    ),
    createId('action', action, savedObject)
  );

  const handledInviteAction = handleParticipants(
    Object.assign({}, inviteAction, {
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString(),
      result: getId(savedObject),
      recipient: handledRecipient,
      // Note: we embed AcceptAction in the potential action so we know if invite was accepted or rejected for notification
      potentialAction: arrayify(inviteAction.potentialAction)
        .filter(action => getId(action) !== getId(handledAction))
        .concat(
          pick(handledAction, [
            '@id',
            '@type',
            'actionStatus',
            'startTime',
            'endTime'
          ])
        )
    }),
    savedObject
  );

  const [savedAction, savedInviteAction] = await this.put(
    [handledAction, handledInviteAction],
    { store, force: true }
  );

  await this.syncParticipants(savedObject, { store });

  return Object.assign({}, savedAction, {
    result: Object.assign({}, savedInviteAction, { result: savedObject })
  });
}
