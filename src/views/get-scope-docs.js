import { toIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * Get ALL the documents associated with a scope
 */
export default function getScopeDocs(scopeId, { store } = {}, callback) {
  scopeId = getId(scopeId);

  this.db.get(
    {
      url: '/_all_docs',
      qs: {
        startkey: JSON.stringify(toIndexableString([scopeId, ''])),
        endkey: JSON.stringify(toIndexableString([scopeId, '\ufff0'])),
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      callback(null, getDocs(body));
    }
  );
}
