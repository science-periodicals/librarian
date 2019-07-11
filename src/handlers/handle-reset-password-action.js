import crypto from 'crypto';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getObjectId } from '../utils/schema-utils';
import setId from '../utils/set-id';
import createId from '../create-id';

/**
 * {
 *   '@type': 'ResetPasswordAction',
 *   object: 'user:userId',
 *   actionStatus: 'CompletedActionStatus',
 *   result: {
 *     '@type': 'Token',
 *     tokenType: 'passwordResetToken',
 *     value: 'token-to-reset-password'
 *   }
 * };
 */
export default async function handleResetPasswordAction(
  action,
  { store } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  // Note: checkWriteAcl ensure that the `agent` is compatible with the `object`
  const userId = getObjectId(action);
  if (!userId || !userId.startsWith('user:')) {
    throw createError(
      400,
      `${action['@type']} targetCollection must be the user @id`
    );
  }

  const actionId = createId('action', action, userId);

  const token = Object.assign(createId('token'), {
    '@type': 'Token',
    tokenType: 'passwordResetToken',
    resultOf: getId(actionId),
    value: crypto.randomBytes(16).toString('hex')
  });

  await new Promise((resolve, reject) => {
    this.tokenStore.setex(
      token,
      1000 * 60 * 60 * 24 /* 1 hour (in seconds) */,
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });

  const handledAction = setId(
    Object.assign(
      {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString()
      },
      action,
      {
        object: userId,
        result: getId(token)
      }
    ),
    actionId
  );

  return this.put(handledAction, { force: true, store });
}
