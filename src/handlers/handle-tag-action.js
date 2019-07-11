import createError from '@scipe/create-error';
import omit from 'lodash/omit';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import { ensureAgentCompliance } from '../validators';
import setId from '../utils/set-id';
import { getObjectId } from '../utils/schema-utils';

export default async function handleTagAction(
  action,
  { store, triggered, prevAction } = {}
) {
  // validation
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  // validate result
  const { result } = action;
  if (!result || !result.name || typeof result.name !== 'string') {
    throw createError(
      400,
      'TagAction must have a valid result of @type "Tag" with at least a "name" property taking a string as value'
    );
  }

  if (result['@id']) {
    if (createId('tag', result.name)['@id'] !== result['@id']) {
      throw createError(400, 'Invalid @id for the tag');
    }
  }

  // The object of a TagAction must be a live Graph
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(
      400,
      'TagAction must have a valid object pointing to a Graph'
    );
  }
  const graph = await this.get(objectId, {
    store,
    acl: false
  });

  if (graph['@type'] !== 'Graph' || graph.version != null) {
    throw createError(
      400,
      `TagAction must have a valid object pointing to a live Graph`
    );
  }

  // validate agent
  try {
    var agent = ensureAgentCompliance(action.agent, graph, {
      ignoreEndDateOnPublicationOrRejection: true
    });
  } catch (err) {
    throw err;
  }

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          startTime: new Date().toISOString()
        },
        action,
        {
          agent,
          result: Object.assign(
            {
              '@type': 'Tag'
            },
            omit(result, ['_id', '_rev']),
            {
              '@id': createId('tag', result.name)['@id']
            }
          ),
          endTime: new Date().toISOString()
        }
      ),
      graph
    ),
    createId('action', action, graph)
  );

  const savedAction = await this.put(handledAction, {
    store,
    force: true
  });

  try {
    await this.syncGraph(graph, savedAction, { store });
  } catch (err) {
    this.log.error({ err, action: savedAction }, 'error syncing graphs');
  }

  return savedAction;
}
