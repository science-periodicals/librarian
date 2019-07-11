import pick from 'lodash/pick';
import omit from 'lodash/omit';
import { arrayify, unrole, getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { normalizePermissions, getGranteeId } from '../acl';
import { validateDigitalDocumentPermission } from '../validators';
import createId from '../create-id';
import schema from '../utils/schema';
import handleParticipants from '../utils/handle-participants';
import getActiveRoles from '../utils/get-active-roles';
import setId from '../utils/set-id';
import getScopeId from '../utils/get-scope-id';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { getObjectId, getAgentId } from '../utils/schema-utils';

/**
 * DeauthorizeAction allow to:
 * - Remove permissions of Periodical (permission of Graph are only set through WorkflowSpecification and PublishAction) (specified as `instrument`)
 * - Remove audience to Action (specified as `recipient`)
 * See AuthorizeAction for opposite action
 */
export default async function handleDeauthorizeAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (prevAction && !triggered) {
    // there may be a prevAction in case of editorial workflow
    action = Object.assign(
      {},
      prevAction,
      action,
      pick(prevAction, ['@type', 'object', 'recipient', 'instrument'])
    );
  }

  // get and validate object
  const object = await this.get(getObjectId(action), {
    store,
    acl: false
  });
  if (
    !object ||
    (object['@type'] !== 'Periodical' && !schema.is(object, 'Action'))
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } must have an object pointing to a Periodical, or an Action`
    );
  }

  // handle agent and resolve reference if possible
  let handledAgent;
  if (action.agent) {
    const sourceRole = findRole(action.agent, object, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (sourceRole) {
      handledAgent = remapRole(sourceRole, 'agent', { dates: false });
    } else {
      handledAgent =
        typeof action.agent === 'string'
          ? action.agent
          : pick(action.agent, ['@id', '@type', 'name', 'roleName', 'agent']); // works for both role and user
    }
  } else {
    handledAgent = 'bot:scipe';
  }

  switch (object['@type']) {
    case 'Periodical': {
      const permissions = arrayify(action.instrument);
      try {
        validateDigitalDocumentPermission(permissions, {
          validGranteeIds: new Set(
            getActiveRoles(object)
              .map(role => getAgentId(role))
              .filter(agentId => agentId && agentId.startsWith('user:'))
          )
        });
      } catch (err) {
        throw err;
      }

      if (!permissions.length) {
        throw createError(
          400,
          `${
            action['@type']
          } must have an instrument containing valid DigitalDocumentPermission`
        );
      }

      const savedObject = await this.update(
        object,
        object => {
          const normalizedPermissions = arrayify(
            normalizePermissions({
              hasDigitalDocumentPermission: permissions
            }).hasDigitalDocumentPermission
          );

          const nextPermissions = arrayify(
            object.hasDigitalDocumentPermission
          ).filter(permission => {
            return !normalizedPermissions.some(_permission => {
              return (
                _permission.permissionType === permission.permissionType &&
                getGranteeId(_permission.grantee) ===
                  getGranteeId(permission.grantee)
              );
            });
          });

          // update periodical
          return nextPermissions.length
            ? Object.assign({}, object, {
                hasDigitalDocumentPermission: nextPermissions
              })
            : omit(object, ['hasDigitalDocumentPermission']);
        },
        { store }
      );

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            action,
            {
              agent: handledAgent,
              result: getId(savedObject)
            }
          ),
          savedObject
        ),
        createId('action', action, savedObject)
      );

      const savedAction = await this.put(handledAction, { store, force: true });
      return Object.assign({}, savedAction, { result: savedObject });
    }

    default: {
      // Action
      const graph = await this.get(getScopeId(object), {
        store,
        acl: false
      });
      if (graph['@type'] !== 'Graph') {
        throw createError(
          400,
          `${
            action['@type']
          } must have an object pointing to an action involved with a Graph`
        );
      }

      const audiences = arrayify(action.recipient);
      const now = new Date().toISOString();

      if (
        !audiences.length ||
        audiences.some(audience => !audience.audienceType)
      ) {
        throw createError(
          400,
          `${
            action['@type']
          } must have a recipient property containing valid Audience`
        );
      }

      const savedObject = await this.update(
        object,
        object => {
          const removedAudienceTypeSet = new Set(
            audiences.map(audience => audience.audienceType)
          );

          return handleParticipants(
            Object.assign({}, object, {
              participant: arrayify(object.participant).map(role => {
                const unroled = unrole(role, 'participant');

                // Terminate deauthorized audiences
                if (
                  unroled.audienceType &&
                  removedAudienceTypeSet.has(unroled.audienceType)
                ) {
                  return Object.assign({}, role, {
                    endDate: now
                  });
                }

                return role;
              })
            }),
            graph
          );
        },
        { store }
      );

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            action,
            {
              agent: handledAgent,
              result: getId(savedObject)
            }
          ),
          graph
        ),
        createId('action', action, graph)
      );

      const savedAction = await this.put(handledAction, { store, force: true });

      if (getId(savedAction.resultOf)) {
        try {
          await this.syncWorkflow([savedAction, savedObject], { store });
        } catch (err) {
          this.log.error(
            { err, action: savedAction, object: savedObject },
            'error syncing workflowStage'
          );
        }
      }

      return Object.assign({}, savedAction, { result: savedObject });
    }
  }
}
