import assert from 'assert';
import { getAgent } from 'schema.org/utils';
import { getId, arrayify } from '@scipe/jsonld';
import { createId, handleParticipants } from '../src';

describe('handle participants', function() {
  it('should handle participant', () => {
    const graph = Object.assign(createId('graph'), {
      '@type': 'Graph',
      author: Object.assign(createId('role'), {
        '@type': 'ContributorRole',
        roleName: 'author',
        startDate: new Date().toISOString(),
        author: createId('user', 'tiffany')['@id']
      }),
      editor: Object.assign(createId('role'), {
        '@type': 'ContributorRole',
        roleName: 'editor',
        startDate: new Date().toISOString(),
        editor: createId('user', 'peter')['@id']
      })
    });

    const action = Object.assign(createId('action', null, graph), {
      '@type': 'Action',
      participant: [
        {
          '@type': 'Audience',
          audienceType: 'editor'
        },
        Object.assign(createId('srole', null, getId(graph.author)), {
          '@type': 'ContributorRole',
          roleName: 'participant',
          startDate: new Date().toISOString(),
          participant: getAgent(graph.author)
        })
      ]
    });

    const nextAction = handleParticipants(action, graph);
    const nextAudience = arrayify(nextAction.participant).find(
      participant => participant['@type'] === 'AudienceRole'
    );

    // console.log(require('util').inspect(nextAction, { depth: null }));

    assert(getId(nextAudience), 'audience @id was added');

    // audience was upgraded to audience role
    assert.equal(nextAudience['@type'], 'AudienceRole');

    // editor participant was added to audience
    assert(
      arrayify(nextAction.participant).some(
        participant => participant.participant === 'user:peter'
      )
    );

    // author role was terminated
    assert(
      arrayify(nextAction.participant).some(
        participant =>
          participant.participant === 'user:tiffany' && participant.endDate
      )
    );
  });
});
