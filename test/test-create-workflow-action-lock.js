import assert from 'assert';
import { Librarian, createId } from '../src';

describe('createWorkflowActionLock', function() {
  this.timeout(40000);

  const librarian = new Librarian();

  it('should create a workflow action lock and allow to unlock it', async () => {
    const graphId = createId('graph')['@id'];
    const lock = await librarian.createWorkflowActionLock({
      '@type': 'ReviewAction',
      resultOf: createId('action', null, graphId),
      instanceOf: createId('action', null, graphId)
    });

    assert(lock && typeof lock.unlock === 'function');
    await lock.unlock();
  });

  it('should create a workflow action lock and allow to unlock it with a callback interface', done => {
    const graphId = createId('graph')['@id'];
    librarian.createWorkflowActionLock(
      {
        '@type': 'ReviewAction',
        resultOf: createId('action', null, graphId),
        instanceOf: createId('action', null, graphId)
      },
      (err, lock) => {
        if (err) return done(err);
        assert(lock && typeof lock.unlock === 'function');

        lock.unlock(err => {
          if (err) {
            return done(err);
          }
          done();
        });
      }
    );
  });

  it('should throw when locked', async () => {
    const graphId = createId('graph')['@id'];
    const action = {
      '@type': 'ReviewAction',
      resultOf: createId('action', null, graphId),
      instanceOf: createId('action', null, graphId)
    };
    await librarian.createWorkflowActionLock(action);

    await assert.rejects(librarian.createWorkflowActionLock(action), {
      code: 423
    });
  });
});
