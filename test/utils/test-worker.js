var Worker = require('@scipe/workers').Worker;

class TestWorker extends Worker {
  constructor(config = {}) {
    config = Object.assign(
      {
        type: 'DocumentProcessingAction'
      },
      config
    );
    super(config);
  }

  onCanceledActionStatus(action, callback) {
    callback(
      null,
      Object.assign({}, action, { actionStatus: 'CanceledActionStatus' })
    );
  }

  handleAction(action, callback) {
    if (action.delay) {
      setTimeout(() => {
        callback(
          null,
          Object.assign({}, action, { actionStatus: 'CompletedActionStatus' })
        );
      }, action.delay);
    } else {
      callback(
        null,
        Object.assign({}, action, { actionStatus: 'CompletedActionStatus' })
      );
    }
  }
}

var w = new TestWorker({
  log: { name: 'test-worker', level: 'fatal' }
});
w.listen();
