import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getContactPointScopeId } from '../utils/contact-point-utils';
import { getObject } from '../utils/schema-utils';
import { handleOverwriteUpdate } from '../utils/pouch';

/**
 *  This is used when a user click on a validate email link
 */
export default async function validateContactPointEmail(
  contactPointId,
  token,
  {
    store,
    mode // set to `document` to get the full scope instead of just the updated contact point
  } = {}
) {
  contactPointId = getId(contactPointId);

  if (
    !token ||
    token.tokenType !== 'emailVerificationToken' ||
    typeof token.value !== 'string' ||
    !getId(token.instrumentOf)
  ) {
    throw createError(
      400,
      'validateContactPointEmail: mispecified emailVerificationToken token'
    );
  }

  const scope = await this.get(getContactPointScopeId(contactPointId), {
    store,
    acl: false
  });

  const contactPoint = arrayify(scope.contactPoint).find(
    cp => getId(cp) === contactPointId
  );
  if (!contactPoint) {
    throw createError(
      400,
      `validateContactPointEmail: could not find ${contactPointId} in ${getId(
        scope
      )}`
    );
  }

  // validate the token with the token store
  await new Promise((resolve, reject) => {
    this.tokenStore.get(token, (err, storedToken) => {
      if (err) {
        return reject(err);
      }

      if (
        !storedToken ||
        getId(storedToken.instrumentOf) !== getId(token.instrumentOf) ||
        storedToken.value !== token.value ||
        storedToken.tokenType !== token.tokenType
      ) {
        return reject(
          createError(
            400,
            `Invalid Token to verify contactPoint ${contactPointId}`
          )
        );
      }

      resolve();
    });
  });

  // We check that the updated email still match the current one from the contact point
  const updateContactPointAction = await this.get(token.instrumentOf, {
    acl: false,
    store
  });

  const updatedContactPoint = handleOverwriteUpdate(
    contactPoint,
    getObject(updateContactPointAction),
    updateContactPointAction.targetCollection.hasSelector
  );

  if (
    contactPoint.verificationStatus === 'VerifiedVerificationStatus' ||
    updatedContactPoint.email !== contactPoint.email
  ) {
    await new Promise((resolve, reject) => {
      this.tokenStore.remove(token, err => {
        if (err) {
          this.log.error(
            { err, token },
            'error deleting token, it will autoexpire'
          );
        }
        resolve();
      });
    });

    if (
      contactPoint.verificationStatus === 'VerifiedVerificationStatus' &&
      updatedContactPoint.email === contactPoint.email
    ) {
      throw createError(
        400,
        `Outdated token, email ${contactPoint.email} was already verified`
      );
    } else {
      throw createError(
        400,
        `Outdated token, latest email is now ${contactPoint.email} (got ${
          updatedContactPoint.email
        })`
      );
    }
  }

  const updatedScope = await this.update(
    scope,
    scope => {
      return Object.assign({}, scope, {
        contactPoint: arrayify(scope.contactPoint).map(contactPoint => {
          if (getId(contactPoint) === contactPointId) {
            return Object.assign({}, contactPoint, {
              verificationStatus: 'VerifiedVerificationStatus'
            });
          }
          return contactPoint;
        })
      });
    },
    {
      store
    }
  );

  await new Promise((resolve, reject) => {
    this.tokenStore.remove(token, err => {
      if (err) {
        this.log.error(
          { err, token },
          'error deleting token, it will autoexpire'
        );
      }
      resolve();
    });
  });

  return mode === 'document'
    ? updatedScope
    : arrayify(updatedScope.contactPoint).find(
        cp => getId(cp) === contactPointId
      );
}
