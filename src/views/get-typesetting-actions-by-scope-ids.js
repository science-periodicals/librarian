import { arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import { getDocs } from '../low';

export default function getTypesettingActionsByScopeIds(
  scopeIds,
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.view.post(
    {
      url: '/actionsByScopeIdAndType',
      json: {
        keys: arrayify(scopeIds).map(id => [
          getScopeId(id),
          'TypesettingAction'
        ])
      },
      qs: {
        reduce: false,
        include_docs: true
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      callback(null, getDocs(body));
    }
  );
}
