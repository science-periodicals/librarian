import zmq from 'zeromq';
import createError from '@scipe/create-error';

/**
 * Publish an action to the workers
 * Typically used to cancel a job by publishing a `CancelAction`
 */
export default function publish(action, callback) {
  if (!action || !action['@type']) {
    return callback(createError(400, 'dispatch: action need a @type'));
  }

  const pub = zmq.socket(
    'push' /* Formerly 'pub' see https://stackoverflow.com/questions/43129714/zeromq-xpub-xsub-serious-flaw and broker */
  );
  const topic = 'worker';

  pub.connect(this.XSUB_ENDPOINT);

  pub.send([topic, JSON.stringify(action)], undefined, (...args) => {
    try {
      pub.close();
    } catch (err) {
      this.log.error(err, 'error closing zmq PUB socket');
    }

    callback(null);
  });
}
