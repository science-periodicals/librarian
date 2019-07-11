import createError from '@scipe/create-error';
import { getDocs } from '../low';
import getScopeId from '../utils/get-scope-id';

export default function getActionsByObjectScopeId(
  object,
  { store } = {},
  callback
) {
  const scopeId = getScopeId(object);

  this.view.get(
    {
      url: '/actionByObjectScopeId',
      qs: Object.assign({
        reduce: false,
        include_docs: true,
        key: `"${scopeId}"`
      }),
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
