import createError from '@scipe/create-error';
import pick from 'lodash/pick';
import { getId, reUuid, unprefix } from '@scipe/jsonld';
import { getObjectId, getAgentId } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import setId from '../utils/set-id';
import handleParticipants from '../utils/handle-participants';
import { ALL_AUDIENCES } from '../constants';
import createId from '../create-id';

// TODO add a lock so there can only be 1 active apply per user role name per journal at a time

/**
 * `agent` (must be a role) applies to a journal (`object`)
 * side effects are handled in `AcceptAction` and `RejectAction` handlers
 */
export default async function handleApplyAction(
  action,
  { store, triggered, prevAction } = {}
) {
  // validation
  if (action.actionStatus === 'CompletedActionStatus') {
    throw createError(
      403,
      `${
        action['@type']
      } cannot be completed, issue an AcceptAction or RejectAction instead`
    );
  }

  // some props cannot be mutated
  if (prevAction) {
    action = Object.assign(
      {},
      action,
      pick(prevAction, ['startTime', 'object'])
    );
  }

  const object = await this.get(getObjectId(action), { acl: false, store });
  if (object['@type'] !== 'Periodical') {
    throw createError(400, `${action['@type']} object must be a Periodical`);
  }

  // agent must be a role not currently present in the journal
  if (
    findRole(action.agent, object, {
      ignoreEndDateOnPublicationOrRejection: true
    }) ||
    !action.agent ||
    (action.agent.roleName !== 'editor' &&
      action.agent.roleName !== 'producer' &&
      action.agent.roleName !== 'reviewer')
  ) {
    throw createError(
      400,
      `${action['@type']} agent must be a Role not already present in ${getId(
        object
      )} with roleName of editor, producer or reviewer`
    );
  }

  // if agent role @id is specified, it must be a UUID
  const agentId = getId(agentId);
  if (
    agentId &&
    !(agentId.startsWith('role:') && reUuid.test(unprefix(agentId)))
  ) {
    throw createError(
      400,
      `${action['@type']} agent role cannot have @id unless it's a new UUID`
    );
  }

  const userId = getAgentId(action.agent);
  if (!userId || !userId.startsWith('user:')) {
    throw createError(
      400,
      `${action['@type']} agent must point to a valid user @id`
    );
  }

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
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
          agent: Object.assign(
            { '@type': 'ContributorRole' },
            pick(action.agent, ['@id', '@type', 'roleName', 'name', 'agent'])
          ),
          object: getId(object)
        }
      ),
      object
    ),
    createId('action', action, object)
  );

  return await this.put(handledAction, {
    store,
    force: true
  });
}
