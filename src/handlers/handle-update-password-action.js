import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { unprefix, getId } from '@scipe/jsonld';
import { getTargetCollectionId, getAgentId } from '../utils/schema-utils';
import createId from '../create-id';
import { createDb } from '../low';
import setId from '../utils/set-id';

/**
 * {
 *   '@type': 'UpdatePasswordAction',
 *   actionStatus: 'CompletedActionStatus',
 *   instrument: {
 *     '@type': 'Password', // or Token of `tokenType` `passwordResetToken` to reset the password
 *     value: 'old-password'
 *   },
 *   object: {
 *     '@type': 'Password',
 *     value: 'new-password'
 *   },
 *   targetCollection: 'user:userId'
 * }
 */
export default async function handleUpdatePasswordAction(
  action,
  { store } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const userId = getTargetCollectionId(action);
  if (!userId || !userId.startsWith('user:')) {
    throw createError(
      400,
      `${action['@type']} targetCollection must be the user @id`
    );
  }

  const newPassword = action.object && action.object.value;
  if (!newPassword) {
    throw createError(
      400,
      `${action['@type']} must specify the new password as object`
    );
  }

  if (
    !action.instrument ||
    (action.instrument['@type'] !== 'Password' &&
      action.instrument['@type'] !== 'Token')
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } must specify an instrument (either the old password or a password reset token)`
    );
  }

  if (action.instrument['@type'] === 'Password') {
    const oldPassword = action.instrument && action.instrument.value;
    if (!oldPassword) {
      throw createError(
        400,
        `${
          action['@type']
        } must specify the old (current) password as instrument`
      );
    }

    try {
      await validatePassword(this.config, unprefix(userId), oldPassword);
    } catch (err) {
      throw createError(
        400,
        `${action['@type']} invalid old (current) password`
      );
    }

    await this.changePassword(unprefix(userId), newPassword);
  } else {
    // Reset password case
    const storedToken = await new Promise((resolve, reject) => {
      this.tokenStore.get(action.instrument, (err, storedToken) => {
        if (err) return reject(err);
        resolve(storedToken);
      });
    });

    if (storedToken.value !== action.instrument.value) {
      throw createError(
        400,
        `${action['@type']} invalid token value (mismatch)`
      );
    }

    // extra check: check that agent match the one of the initial ResetPasswordAction (as in this case checkWriteAcl did not require credentials)
    const resetPasswordAction = await this.get(getId(storedToken.resultOf), {
      store,
      acl: false
    });
    if (getAgentId(resetPasswordAction.agent) !== userId) {
      throw createError(
        400,
        `${action['@type']} invalid token value (mismatch)`
      );
    }

    await this.changePassword(unprefix(userId), newPassword);

    await new Promise((resolve, reject) => {
      this.tokenStore.remove(action.instrument, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // we don't store the passwords
  const handledAction = setId(
    Object.assign(omit(action, ['instrument', 'object']), {
      endTime: new Date().toISOString()
    }),
    createId('action', action, userId)
  );

  return this.put(handledAction, { force: true, store });
}

function validatePassword(config, username, password) {
  const db = createDb(config);

  return new Promise((resolve, reject) => {
    db.get(
      {
        url: `/${encodeURIComponent(createId('profile', username)._id)}`,
        json: true,
        auth: {
          username,
          password
        }
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
