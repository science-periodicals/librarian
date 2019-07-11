import zmq from 'zeromq';
import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import once from 'once';
import { getSocketIdentity } from '../low';

/**
 * Dispatch an action to the workers
 */
export default function dispatch(action, callback) {
  callback = once(callback);

  if (!action || !action['@type']) {
    return callback(createError(400, 'dispatch: action need a @type'));
  }

  const sock = zmq.socket('req');
  sock.identity = getSocketIdentity(action);
  this.log.trace(
    {
      WORKER_BROKER_FRONTEND: this.BROKER_FRONTEND,
      action: action
    },
    'librarian#dispatch: dispatching action to broker'
  );

  const timeoutMs = 1 * 60 * 1000; // 1 min
  const timeoutId = setTimeout(() => {
    try {
      sock.close();
    } catch (err) {
      this.log.error(err, 'error closing zmq REQ socket');
    }

    callback(
      createError(
        500,
        `Could not dispatch action ${getId(action)} (${
          action['@type']
        }) to workers (timeout ${timeoutMs}ms)`
      )
    );
  }, timeoutMs);

  sock.connect(this.BROKER_FRONTEND);
  sock.send(JSON.stringify(action));

  sock.on('message', (data, workerId) => {
    clearTimeout(timeoutId);
    this.log.trace(
      {
        WORKER_BROKER_FRONTEND: this.BROKER_FRONTEND,
        data: data.toString(),
        workerId: workerId.toString()
      },
      'librarian#dispatch: broker confirmation received'
    );
    try {
      sock.close();
    } catch (err) {
      this.log.error(err, 'error closing zmq REQ socket');
    }
    callback(null, [data.toString(), workerId.toString()]);
  });
}
