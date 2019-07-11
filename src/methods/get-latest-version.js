import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';

export default function getLatestVersion(graphId, callback) {
  graphId = getId(graphId);
  if (!graphId) {
    return callback(createError(400, 'invalid graphId'));
  }
  // get the previous latest version (if any)
  this.get(
    createId('release', 'latest', graphId, true)._id,
    { acl: false },
    (err, doc) => {
      if (err && err.code !== 404) {
        return callback(err);
      }
      let version;
      if (err && err.code === 404) {
        version = null;
      } else {
        version = doc.version;
      }
      callback(null, version);
    }
  );
}
