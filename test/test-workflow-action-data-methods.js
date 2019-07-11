import assert from 'assert';
import { Librarian, createId, Store } from '../src';

describe('workflow action data methods', function() {
  this.timeout(40000);

  const librarian = new Librarian();

  it('should add and get workflow action _ids', async () => {
    const graphId = createId('graph')['@id'];

    const doc = Object.assign(createId('action', null, graphId), {
      '@type': 'ReviewAction',
      actionStatus: 'ActiveActionStatus'
    });

    await librarian.syncWorkflowActionDataSummary(doc);
    const summary = await librarian.getWorkflowActionDataSummary(graphId);
    assert.deepEqual(
      {
        _id: doc._id,
        '@type': doc['@type'],
        actionStatus: doc.actionStatus
      },
      summary[0]
    );
  });

  it('should delete a set when the scope is published or rejected', async () => {
    const graphId = createId('graph');

    const docs = [
      Object.assign(graphId, {
        '@type': 'Graph',
        datePublished: new Date().toISOString()
      }),
      Object.assign(createId('action', null, graphId), {
        '@type': 'AssessAction'
      })
    ];

    await librarian.syncWorkflowActionDataSummary(docs);
    const summary = await librarian.getWorkflowActionDataSummary(graphId);
    assert.deepEqual(summary, []);
  });

  it('should ensureWorkflowActionStateMachineStatus', async () => {
    const graphId = createId('graph')['@id'];

    const action = Object.assign(createId('action', null, graphId), {
      '@type': 'ReviewAction',
      actionStatus: 'ActiveActionStatus'
    });

    await librarian.syncWorkflowActionDataSummary(action);

    const potentialAction = Object.assign({}, action, {
      actionStatus: 'PotentialActionStatus'
    });
    const stagedAction = Object.assign({}, action, {
      actionStatus: 'StagedActionStatus'
    });
    const completedAction = Object.assign({}, action, {
      actionStatus: 'CompletedActionStatus'
    });
    const canceledAction = Object.assign({}, action, {
      actionStatus: 'CanceledActionStatus'
    });
    const failedAction = Object.assign({}, action, {
      actionStatus: 'FailedActionStatus'
    });

    await assert.doesNotReject(
      librarian.ensureWorkflowActionStateMachineStatus(completedAction, {
        store: new Store(completedAction)
      })
    );
    await assert.doesNotReject(
      librarian.ensureWorkflowActionStateMachineStatus(stagedAction, {
        store: new Store(stagedAction)
      })
    );
    await assert.doesNotReject(
      librarian.ensureWorkflowActionStateMachineStatus(failedAction, {
        store: new Store(failedAction)
      })
    );
    await assert.doesNotReject(
      librarian.ensureWorkflowActionStateMachineStatus(canceledAction, {
        store: new Store(canceledAction)
      })
    );

    await assert.rejects(
      librarian.ensureWorkflowActionStateMachineStatus(potentialAction, {
        store: new Store(potentialAction)
      }),
      {
        code: 503
      }
    );
  });
});
