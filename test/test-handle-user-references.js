import assert from 'assert';
import { getId } from '@scipe/jsonld';
import { createId, handleUserReferences } from '../src';

describe('handle user references', function() {
  it('should remove user references', () => {
    const graphId = createId('graph')['@id'];
    const userId = createId('user', 'peter')['@id'];
    const roleId = createId('role')['@id'];

    const action = Object.assign(createId('action', null, graphId), {
      '@type': 'CreateReleaseAction',
      actionStatus: 'ActiveActionStatus',
      agent: {
        '@id': roleId,
        '@type': 'ContributorRole',
        roleName: 'author',
        startDate: new Date().toISOString(),
        agent: userId
      },
      participant: Object.assign(createId('srole', null, roleId), {
        '@type': 'ContributorRole',
        roleName: 'participant',
        startDate: new Date().toISOString(),
        participant: userId
      })
    });

    const safeAction = handleUserReferences(action);
    // console.log(require('util').inspect(safeAction, { depth: null }));

    assert(action.agent.agent && !safeAction.agent.agent);
    assert(
      action.participant.participant && !safeAction.participant.participant
    );
  });

  it('should add back user references', () => {
    const graph = Object.assign(createId('graph'), {
      '@type': 'Graph',
      author: Object.assign(createId('role'), {
        '@type': 'ContributorRole',
        roleName: 'author',
        startDate: new Date().toISOString(),
        author: createId('user', 'peter')['@id']
      }),
      editor: Object.assign(createId('role'), {
        '@type': 'ContributorRole',
        roleName: 'editor',
        startDate: new Date().toISOString(),
        editor: createId('user', 'tiffany')['@id']
      })
    });

    const safeAction = Object.assign(createId('action', null, graph), {
      '@type': 'CreateReleaseAction',
      actionStatus: 'CompletedActionStatus',
      agent: {
        '@id': getId(graph.author),
        '@type': 'ContributorRole',
        roleName: 'author',
        startDate: new Date().toISOString()
      },
      participant: Object.assign(createId('srole', null, getId(graph.editor)), {
        '@type': 'ContributorRole',
        roleName: 'editor',
        startDate: new Date().toISOString()
      })
    });

    const restoredAction = handleUserReferences(safeAction, graph);
    // console.log(require('util').inspect(restoredAction, { depth: null }));
    assert.equal(restoredAction.agent.agent, 'user:peter');
    assert.equal(restoredAction.participant.participant, 'user:tiffany');
  });
});
