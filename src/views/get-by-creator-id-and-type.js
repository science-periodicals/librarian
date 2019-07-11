import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * keys is [[creatorId, type]]
 */
export default function getByCreatorIdAndType(keys, callback) {
  if (!Array.isArray(keys[0])) {
    keys = [keys];
  }
  keys = keys.map(key => {
    return [getId(key[0]), key[1]];
  });

  this.view.post(
    {
      url: '/byCreatorIdAndType',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: {
        keys
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const docs = getDocs(body);
      callback(null, docs);
    }
  );
}
