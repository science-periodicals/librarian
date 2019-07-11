export default function close(callback) {
  // close any open sockets so that the process can exit.
  // TODO destroy bunyan logger see https://github.com/trentm/node-bunyan/issues/365 ? it doesn't seem to matter so probably OK
  const promises = [];

  if (this.ownRedis && this.redis) {
    promises.push(
      new Promise((resolve, reject) => {
        try {
          this.redis.quit(err => {
            if (err) return reject(err);
            this.redis.unref();
            resolve();
          });
        } catch (e) {
          this.log.error({ err: e }, 'error calling redis.quit');
          reject(e);
        }
      })
    );
  }

  if (this.redlock) {
    promises.push(
      new Promise((resolve, reject) => {
        try {
          this.redlock.quit(err => {
            if (err) return reject(err);
            resolve();
          });
        } catch (e) {
          this.log.error({ err: e }, 'error calling redlock.quit');
          reject(e);
        }
      })
    );
  }

  return Promise.all(promises)
    .then(() => {
      if (callback) callback(null);
    })
    .catch(err => {
      if (callback) {
        callback(err);
      } else {
        throw err;
      }
    });
}
