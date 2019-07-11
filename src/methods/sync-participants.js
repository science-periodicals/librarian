import { getId } from '@scipe/jsonld';
import handleParticipants from '../utils/handle-participants';

/**
 * This method must be called after a successfull InviteAction (or JoinAction or
 * AuthorizeContributorAction) so that all the actions associated with a scope
 * see their audience updated to reflect the new invitee
 *
 * Returns a list of updated actions (may be an empty list)
 */
export default async function syncParticipants(
  scope, // Graph, Periodical or Organization _including_ the new invitee
  { store, now } = {}
) {
  if (scope['@type'] !== 'Graph') {
    return [];
  }

  // We only do that for actions related to graphs
  if (scope['@type'] !== 'Graph') {
    return [];
  }

  const actions = await this.getActionsByScopeId(getId(scope), { store });

  const updatedActions = [];
  // Note: handleParticipants returns the original action if no changes were made
  // => we can use that to only return the action that were  updated
  actions.forEach(action => {
    const handledAction = handleParticipants(action, scope, now);
    if (handledAction !== action) {
      updatedActions.push(handledAction);
    }
  });

  if (updatedActions.length) {
    return this.put(updatedActions, { force: true, store });
  } else {
    return [];
  }
}
