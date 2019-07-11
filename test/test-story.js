import assert from 'assert';
import util from 'util';
import colors from 'colors'; // eslint-disable-line
import { Librarian, Store } from '../src';
import story from './story';

// The following commented out lines are useful to debug stories when we suspect that there is a librarian bug causing an error
// Uncomment and run this test to have access to the line number from src/ instead of dist/
// Note: this require to link @scienceai/stories
// import { createTypesettingStory } from '@scienceai/stories';
// const story = createTypesettingStory();

/* eslint-disable no-console */

describe('story', function() {
  this.timeout(4000000);

  it('should run the story', async () => {
    const handledActions = await run(
      story,
      { skipPayments: true, skipDoiRegistration: true },
      !true
    ); // Set to true when testing with @scienceai/stories
    assert(handledActions.length);
  });
});

async function run(story, config, debug = false) {
  const librarian = new Librarian(config);
  const store = new Store();

  const handledActions = [];

  let i = 0;
  for (const action of story) {
    if (debug) {
      console.log(
        'POSTing: ' + action['@type'].magenta + ` (${i++}/${story.length})\n`
      );
      console.log(util.inspect(action, { depth: null }));
    }
    const [handledAction, ...triggeredActions] = await librarian.post(action, {
      store,
      acl: false,
      strict: false,
      rpc: true,
      addTriggeredActionToResult: true
    });
    handledActions.push(handledAction, ...triggeredActions);

    if (debug) {
      console.log('\n->\n'.grey);
      console.log(util.inspect(handledAction, { depth: null }));
      if (triggeredActions.length) {
        console.log('\n ' + 'triggered'.yellow + ':\n');
        console.log(util.inspect(triggeredActions, { depth: null }));
      }
      console.log('\n             =====================             \n'.grey);
    }
  }
  if (debug) {
    console.log(
      `completed (${story.length} action${story.length > 1 ? 's' : ''})`
    );
  }

  librarian.close();

  return handledActions;
}
