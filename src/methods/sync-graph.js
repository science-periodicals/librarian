import pick from 'lodash/pick';
import identity from 'lodash/identity';
import { getId, arrayify } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import createId from '../create-id';
import { endGraphRoles } from '../utils/role-utils';

// !! keep that in sync with the ddoc
const indexedActionTypes = new Set([
  'TagAction',
  'CreateReleaseAction',
  'PublishAction',
  'DeclareAction',
  'ReviewAction',
  'AssessAction',
  'PayAction',
  'BuyAction',
  'TypesettingAction',
  'InviteAction'
]);

/**
 * Embed (or remove) `actions` to the (live) Graph in `@lucene` (for indexing purposes)
 */
export default function syncGraph(
  graph,
  actions,
  {
    store,
    updatePayload,
    update = identity,
    endRoles = false,
    now = new Date().toISOString()
  } = {},
  callback
) {
  updatePayload = Object.assign(
    { dateModified: new Date().toISOString() },
    updatePayload
  );

  actions = arrayify(actions)
    .filter(
      action =>
        action && action['@type'] && indexedActionTypes.has(action['@type'])
    )
    .map(action => dehydrate(action));

  this.update(
    createId('graph', getScopeId(graph)), // ensure that version is removed
    graph => {
      let nextGraph = update(
        Object.assign({}, graph, updatePayload, {
          '@lucene': arrayify(graph['@lucene'])
            .filter(
              action =>
                !actions.some(_action => getId(_action) === getId(action))
            )
            .concat(actions.filter(action => !action._deleted)) // be sure not to add back the deleted one
        })
      );

      if (endRoles) {
        nextGraph = endGraphRoles(nextGraph, { now });
      }

      return nextGraph;
    },
    { store, lucene: true },
    callback
  );
}

/**
 * We only keep @id, @type and actionStatus as well as a subset of the agent props
 * !! keep that in sync with the ddoc
 */
function dehydrate(action) {
  const stub = pick(
    action,
    ['@id', '@type', 'agent', 'actionStatus'].concat(
      action['@type'] === 'TagAction' ? 'result' : []
    )
  );

  // further dehydrate `agent`
  if (stub.agent) {
    let dehydratedAgent;
    if (stub.agent.agent) {
      // role
      dehydratedAgent = pick(stub.agent, ['@id', '@type', 'name', 'roleName']);
      if (getId(stub.agent.agent)) {
        dehydratedAgent.agent = getId(stub.agent.agent);
      }
    } else {
      if (getId(stub.agent)) {
        dehydratedAgent = getId(stub.agent);
      }
    }
    if (dehydratedAgent) {
      stub.agent = dehydratedAgent;
    }
  }

  return stub;
}
