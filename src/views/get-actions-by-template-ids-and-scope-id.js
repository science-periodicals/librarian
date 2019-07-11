import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import getScopeId from '../utils/get-scope-id';
import { getDocs } from '../low';

export default function getActionsByTemplateIdsAndScopeId(
  templateIds,
  scopeId,
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
  const { fromCache = false, store } = opts;

  templateIds = arrayify(templateIds)
    .map(getId)
    .filter(Boolean);

  scopeId = getScopeId(scopeId);

  const cacheKey = `view:actionsByTemplateIdAndScopeId:${templateIds.join(
    ':'
  )}:${scopeId}`;
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.post(
    {
      url: '/actionsByTemplateIdAndScopeId',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: {
        keys: templateIds.map(templateId => [templateId, scopeId])
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const payload = getDocs(body);

      if (store) {
        store.cache(cacheKey, payload, { includeDocs: true });
      }

      return callback(null, payload);
    }
  );
}
