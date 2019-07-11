import { getId } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import flagDeleted from '../utils/flag-deleted';
import remapRole from '../utils/remap-role';
import setId from '../utils/set-id';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';
import {
  getGraphMainEntityContributorRoles,
  parseRoleIds
} from '../utils/role-utils';
import { ALL_AUDIENCES } from '../constants';
import { getAgentId } from '../utils/schema-utils';

/**
 * Make sure that the active check actions are in sync with the graph main
 * entity authors and contributors
 *
 * Returns the list of created / deleted checkActions
 */
export default async function syncCheckActions(
  graph,
  { store, now = new Date().toISOString() } = {}
) {
  const roles = getGraphMainEntityContributorRoles(graph, { rootOnly: true });
  const roleIds = new Set(roles.map(getId).filter(Boolean));

  const checkActions = await this.getActionsByScopeIdAndTypes(
    getScopeId(graph),
    ['CheckAction'],
    { store }
  );

  const existingRoleIds = new Set(
    checkActions
      .map(action => getId(action.agent))
      .filter(roleId => roleId && roleId.startsWith('role:'))
  );

  const deleted = checkActions
    .filter(action => !roleIds.has(getId(action.agent)))
    .map(action => flagDeleted(action, { now }));

  // We add main entity contributor roles as participants so that main
  // entity contributors who haven't joined the graph are listed in all the
  // check actions so they can see them being clompleted when previewing the
  // graph
  const potentialExtraParticipants = roles
    .filter(role => {
      const { roleId, userId } = parseRoleIds(role);
      return roleId && userId;
    })
    .map(role => {
      return Object.assign(createId('srole', null, getId(role)), {
        '@type': 'ContributorRole',
        roleName: 'participant',
        startDate: now,
        participant: getAgentId(role)
      });
    });

  const created = roles
    .filter(role => !existingRoleIds.has(getId(role)))
    .map(role => {
      const agent = remapRole(role, 'agent', { dates: false });
      if (getId(agent.agent)) {
        agent.agent = getId(agent.agent);
      }

      const action = setId(
        handleParticipants(
          {
            '@type': 'CheckAction',
            agent,
            actionStatus: 'ActiveActionStatus',
            object: getScopeId(graph),
            startTime: now,
            participant: ALL_AUDIENCES.concat(potentialExtraParticipants)
          },
          graph
        ),
        createId('action', null, getId(graph))
      );

      return action;
    });

  const changed = deleted.concat(created);
  let saved = [];
  if (changed.length) {
    saved = await this.put(changed, { store, force: true });
  }

  return saved;
}
