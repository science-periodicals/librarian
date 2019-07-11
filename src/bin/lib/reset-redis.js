import { createRedisClient } from '../../';

export default function resetRedis(keys, config, callback) {
  const redis = createRedisClient(config);
  redis
    .multi(
      keys.map(key => {
        return ['keys', key];
      })
    )
    .exec((err, res) => {
      if (err) return callback(err);
      const keys = Array.prototype.concat.apply([], res);
      if (!keys.length) {
        return callback(null, 0);
      }
      redis.del(keys, (err, res) => {
        if (err) return callback(err);
        callback(null, res);
      });
    });
}
