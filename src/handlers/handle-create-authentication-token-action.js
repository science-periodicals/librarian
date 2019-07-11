import createError from '@scipe/create-error';
import { unprefix, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import createId from '../create-id';
import { getObjectId } from '../utils/schema-utils';

/**
 * The `object` is a userId (ACL is relegated to the checkWriteAcl method)
 */
export default async function createAuthenticationTokenAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const userId = getObjectId(action);
  if (!userId || !userId.startsWith('user:')) {
    throw createError(400, `${action['@type']} agent must be defined`);
  }

  const token = Object.assign(createId('token', null, userId), {
    '@type': 'AuthenticationToken',
    value: uuid.v4()
  });

  const proxyUsername = `${unprefix(userId)}~${token.value}`;

  const proxyUser = Object.assign(createId('user', proxyUsername), {
    type: 'user', // `type` needs to be `user` in Apache CouchDB 2.x
    name: proxyUsername,
    roles: ['proxyUser'],
    password: token.value
  });

  try {
    //saved proxy user to CouchDB _user database
    const savedProxyUser = await saveProxyUser(proxyUser, {
      librarian: this,
      store
    });
    this.log.debug({ savedProxyUser }, 'proxyUser created');
  } catch (err) {
    this.log.error(
      { err, proxyUser, action },
      'createAuthenticationTokenAction : could not create proxy user'
    );
    throw createError(500, 'Could not create proxy user');
  }

  const handledAction = Object.assign(
    { startTime: new Date().toISOString() },
    createId('action', action, userId),
    action,
    {
      endTime: new Date().toISOString(),
      result: getId(token)
    }
  );

  const [savedAction, savedToken] = await this.put([handledAction, token], {
    store,
    force: true
  });

  return Object.assign({}, savedAction, { result: savedToken });
}

async function saveProxyUser(proxyUser, { librarian, store }) {
  return new Promise((resolve, reject) => {
    librarian.authDb.put(
      {
        url: `/${encodeURIComponent(proxyUser._id)}`,
        json: proxyUser
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return reject(err);
        }

        resolve(body);
      }
    );
  });
}
