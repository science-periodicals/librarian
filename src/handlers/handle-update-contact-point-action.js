import crypto from 'crypto';
import reEmail from 'regex-email';
import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { getId, arrayify, unprefix } from '@scipe/jsonld';
import { getTargetCollectionId, getObject } from '../utils/schema-utils';
import { getContactPointScopeId } from '../utils/contact-point-utils';
import { validateOverwriteUpdate } from '../validators';
import { handleOverwriteUpdate } from '../utils/pouch';
import { CONTACT_POINT_ADMINISTRATION } from '../constants';
import setId from '../utils/set-id';
import handleParticipants from '../utils/handle-participants';
import createId from '../create-id';

/**
 * The API provides a contact/:contactId?validate={true|false} endpoint that
 * will set the verificationStatus to `VerifiedVerificationStatus`
 *
 * {
 *   '@type': 'UpdateContactPointAction',
 *   actionStatus: 'CompletedActionStatus',
 *   object: {
 *     email: 'mailto:nextEmail@example.com',
 *     telephone: 'tel:xxxx'
 *   },
 *   targetCollection: 'contact:contactPointId'
 * }
 *
 * We lock on the `CONTACT_POINT_ADMINISTRATION` emails so that they can be used
 * as id for users
 *
 * We set an `emailVerificationToken` (needed by the `validateContactPointEmail` method)
 *
 * See also `validateContactPointEmail` method
 */
export default async function handleUpdateContactPointAction(
  action,
  {
    store,
    prevAction,
    mode,
    strict = true // set to `false` to allow to pass an `emailVerificationToken` as `instrument`
  } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const contactPointId = getTargetCollectionId(action);

  const scope = await this.get(getContactPointScopeId(contactPointId), {
    store,
    acl: false
  });

  const messages = validateOverwriteUpdate(
    scope,
    action.object,
    action.targetCollection.hasSelector,
    {
      immutableProps: [
        '_id',
        '@id',
        '@type',
        'name',
        'description',
        'contactType'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  const contactPoint = arrayify(scope.contactPoint).find(
    contactPoint => getId(contactPoint) === contactPointId
  );
  if (!contactPoint) {
    throw createError(
      400,
      `Invalid targetCollection for ${
        action['@type']
      }, could not find contact point to update in ${getId(scope)}`
    );
  }

  const nextContactPoint = Object.assign(
    {},
    handleOverwriteUpdate(
      contactPoint,
      getObject(action),
      action.targetCollection.hasSelector
    ),
    {
      verificationStatus: 'UnverifiedVerificationStatus' // will be set to `VerifiedVerificationStatus` by the API using the `validateContactPointEmail` method
    }
  );

  if (
    nextContactPoint.email &&
    (!nextContactPoint.email.startsWith('mailto:') ||
      !reEmail.test(unprefix(nextContactPoint.email)))
  ) {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }, object must be an update payload with a valid email value starting with mailto: (got ${
        nextContactPoint.email
      })`
    );
  }

  if (
    nextContactPoint.telephone &&
    !nextContactPoint.telephone.startsWith('tel:')
  ) {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }, object must be an update payload with a valid telephone value starting with tel: (got ${
        nextContactPoint.telephone
      })`
    );
  }

  let lock;
  if (
    contactPoint.contactType === CONTACT_POINT_ADMINISTRATION &&
    nextContactPoint.email !== contactPoint.email
  ) {
    lock = await this.createLock(nextContactPoint.email, {
      prefix: 'email', // !! keep in sync with register action lock
      isLocked: async () => {
        const hasUniqId = await this.hasUniqId(nextContactPoint.email);

        const activeRegisterActions = await this.getActiveRegisterActionsByEmail(
          nextContactPoint.email,
          { store }
        );
        const profiles = await this.getProfilesByEmail(nextContactPoint.email, {
          store
        });

        return hasUniqId || activeRegisterActions.length || profiles.length;
      }
    });
  }

  let handledAction, updatedScope;

  const actionId = createId('action', action, scope);
  let token;
  if (
    !strict &&
    action.instrument &&
    action.instrument.tokenType === 'emailVerificationToken' &&
    typeof action.instrument.value === 'string'
  ) {
    token = Object.assign(
      { '@type': 'Token', tokenType: 'emailVerificationToken' },
      action.instrument,
      createId('token', getId(action.instrument)),
      {
        instrumentOf: getId(actionId)
      }
    );
  } else {
    token = Object.assign(createId('token', getId(action.instrument)), {
      '@type': 'Token',
      tokenType: 'emailVerificationToken',
      value: crypto.randomBytes(16).toString('hex'),
      instrumentOf: getId(actionId)
    });
  }

  try {
    await new Promise((resolve, reject) => {
      this.tokenStore.setex(
        token,
        1000 * 60 * 60 * 24 * 30 /* 1 Month (in seconds) */,
        err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    updatedScope = await this.update(
      scope,
      scope => {
        return Object.assign({}, scope, {
          contactPoint: arrayify(scope.contactPoint).map(contactPoint => {
            if (getId(contactPoint) === getId(nextContactPoint)) {
              return nextContactPoint;
            }
            return contactPoint;
          })
        });
      },
      {
        store,
        ifMatch: action.ifMatch
      }
    );

    handledAction = await this.put(
      setId(
        handleParticipants(
          Object.assign(
            { startTime: new Date().toISOString() },
            omit(action, ['instrument']),
            {
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              result: nextContactPoint
            }
          )
        ),
        actionId
      ),
      { force: true, store }
    );

    if (
      contactPoint.contactType === CONTACT_POINT_ADMINISTRATION &&
      nextContactPoint.email !== contactPoint.email
    ) {
      try {
        await this.removeUniqId(contactPoint.email);
      } catch (err) {
        this.log.fatal(
          { err, contactPoint, nextContactPoint },
          `could not remove ${contactPoint.email} from uid set`
        );
      }
    }
  } catch (err) {
    throw err;
  } finally {
    if (lock) {
      try {
        await lock.unlock();
      } catch (err) {
        this.log.error(
          { err },
          'could not release lock, but it will auto expire'
        );
      }
    }
  }

  return Object.assign({}, handledAction, {
    result: mode === 'document' ? updatedScope : nextContactPoint
  });
}
