import pick from 'lodash/pick';
import { arrayify, unrole, getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { normalizePermissions, getGranteeId } from '../acl';
import { validateDigitalDocumentPermission } from '../validators';
import createId from '../create-id';
import schema from '../utils/schema';
import handleParticipants from '../utils/handle-participants';
import getActiveRoles from '../utils/get-active-roles';
import { getStageId } from '../utils/workflow-actions';
import setId from '../utils/set-id';
import getScopeId from '../utils/get-scope-id';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { getObjectId, getAgent, getAgentId } from '../utils/schema-utils';
import { getStageActions } from '../utils/workflow-utils';

/**
 * AuthorizeAction allow to:
 * - Add permissions of Periodical (permission of Graph are only set through WorkflowSpecification and PublishAction) (specified as `instrument`)
 * - Add audience (specified as `recipient`) to an Action (the audience will be added to `participant`
 * See DeauthorizeAction for opposite action
 */
export default async function handleAuthorizeAction(
  action,
  { store, triggered, triggerType, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (prevAction && !triggered) {
    // there may be a prevAction in case of Editorial workflow
    action = Object.assign(
      {},
      prevAction,
      action,
      pick(prevAction, ['@type', 'object', 'recipient', 'instrument'])
    );
  }

  // get and validate object
  // !! object of authorize action can have object.object but not be a role.
  let objectId = getId(action.object);
  if (
    !objectId ||
    !(objectId.startsWith('action:') || objectId.startsWith('journal:'))
  ) {
    objectId = getObjectId(action);
  }

  const object = await this.get(objectId, {
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

  // handle agent and resolve reference when possible
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

          // update object
          return Object.assign({}, object, {
            hasDigitalDocumentPermission: arrayify(
              object.hasDigitalDocumentPermission
            )
              .filter(permission => {
                return !normalizedPermissions.some(_permission => {
                  return (
                    _permission.permissionType === permission.permissionType &&
                    getGranteeId(_permission.grantee) ===
                      getGranteeId(permission.grantee)
                  );
                });
              })
              .concat(normalizedPermissions)
          });
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

      const savedAction = await this.put(handledAction, { force: true, store });
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

      let now = new Date().toISOString();
      let objectOverwrite;
      if (triggered && triggerType) {
        // In this case `now` needs to be set based on the `triggerType`
        // Note: this is complicated as due to the logic in post.js,
        // the trigger may have been run _before_ the triggering action
        // was triggered
        // => if no relevant date can be found on the triggering action
        // we set it here so it is backported to the action later
        switch (triggerType) {
          case 'OnObjectStagedActionStatus':
            if (object.stagedTime) {
              now = object.stagedTime;
            } else {
              objectOverwrite = { stagedTime: now };
            }
            break;

          case 'OnObjectCompletedActionStatus':
            if (object.endTime) {
              now = object.endTime;
            } else {
              objectOverwrite = { endTime: now };
            }
            break;

          case 'OnWorkflowStageEnd': {
            const stage = await this.get(getStageId(object), {
              store,
              acl: false
            });
            const stageActions = getStageActions(stage);
            const triggeringAction =
              stageActions.find(action => action['@type'] === 'AssessAction') ||
              stageActions.find(action => action['@type'] === 'PublishAction');

            if (triggeringAction && triggeringAction.endTime) {
              now = new Date(
                new Date(triggeringAction.endTime).getTime() + 1
              ).toISOString();
            } else {
              // we need to update the triggering action
              await this.update(
                triggeringAction,
                action => {
                  return Object.assign({ endTime: now }, action);
                },
                { store }
              );
            }

            break;
          }

          default:
            break;
        }
      }

      const savedObject = await this.update(
        object,
        object => {
          const newActiveAudienceTypeSet = new Set(
            audiences.map(audience => audience.audienceType)
          );

          const updatedAudiences = [];
          arrayify(object.participant).forEach(role => {
            const unroled = unrole(role, 'participant');

            if (unroled.audienceType) {
              if (newActiveAudienceTypeSet.has(unroled.audienceType)) {
                // update
                const nextRole = Object.assign({}, role);
                // if the audience will start later, update startDate
                if (role.startDate && role.startDate > now) {
                  nextRole.startDate = now;
                }

                // if the audience will expire but has not already expired, remove endDate
                if (role.endDate && role.endDate >= now) {
                  delete nextRole.endDate;
                }

                updatedAudiences.push(nextRole);
              } else {
                updatedAudiences.push(role);
              }
            }
          });

          const updatedAudiencesActiveAudienceTypeSet = new Set(
            updatedAudiences
              .filter(role => {
                return (
                  (!role.startDate || role.startDate <= now) &&
                  (!role.endDate || role.endDate > now)
                );
              })
              .map(audience => getAgent(audience).audienceType)
          );

          const newAudienceTypes = Array.from(newActiveAudienceTypeSet).filter(
            audienceType =>
              !updatedAudiencesActiveAudienceTypeSet.has(audienceType)
          );

          // we replace the audience by the updated one + the new ones
          const nextParticipants = arrayify(object.participant)
            .filter(role => {
              const unroled = unrole(role, 'participant');
              return !unroled.audienceType;
            })
            .concat(
              updatedAudiences,
              newAudienceTypes.map(audienceType => {
                // handleParticipants will upgrade to AudienceRole etc.
                return {
                  audienceType
                };
              })
            );

          return handleParticipants(
            Object.assign({}, objectOverwrite, object, {
              participant: nextParticipants
            }),
            graph,
            now
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

      const savedAction = await this.put(handledAction, { force: true, store });

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
