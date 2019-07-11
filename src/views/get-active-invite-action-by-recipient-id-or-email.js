import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';
import { getAgent } from '../utils/schema-utils';

export default function getActiveInviteActionByRecipientIdOrEmail(
  recipientIdOrEmail, // can also be a role
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

  const recipient = getAgent(recipientIdOrEmail);

  recipientIdOrEmail =
    getId(recipient) ||
    getId(recipientIdOrEmail) ||
    (recipient && recipient.email);

  if (typeof recipientIdOrEmail !== 'string') {
    return callback(null, []);
  }

  const cacheKey = createCacheKey(recipientIdOrEmail);
  if (store && fromCache) {
    const cached = store.get(cacheKey);
    if (cached) {
      return callback(null, cached);
    }
  }

  this.view.get(
    {
      url: '/activeInviteActionByRecipientIdOrEmail',
      qs: {
        key: JSON.stringify(recipientIdOrEmail),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const activeInviteActions = getDocs(body);

      if (store) {
        store.cache(cacheKey, activeInviteActions, { includeDocs: true });
      }

      callback(null, activeInviteActions);
    }
  );
}

function createCacheKey(recipientIdOrEmail) {
  return `view:activeInviteActionByRecipientIdOrEmail:${recipientIdOrEmail}`;
}

getActiveInviteActionByRecipientIdOrEmail.createCacheKey = createCacheKey;
