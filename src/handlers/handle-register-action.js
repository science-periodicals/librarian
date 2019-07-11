import pick from 'lodash/pick';
import isPlainObject from 'lodash/isPlainObject';
import isEmail from 'isemail';
import { username as validateUsername } from 'npm-user-validate';
import asyncParallel from 'async/parallel';
import asyncEach from 'async/each';
import omit from 'lodash/omit';
import {
  unrole,
  unprefix,
  arrayify,
  dearrayify,
  getId
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';
import createProfile from '../utils/create-profile';
import setId from '../utils/set-id';
import flagDeleted from '../utils/flag-deleted';
import {
  PUBLIC_ROLES,
  CONTACT_POINT_ADMINISTRATION,
  SCIPE_FREE_OFFER_ID,
  SCIPE_EXPLORER_OFFER_ID,
  SCIPE_VOYAGER_OFFER_ID
} from '../constants';
import {
  getAgent,
  getAgentId,
  getObjectId,
  getRootPartId
} from '../utils/schema-utils';
import { validateStylesAndAssets } from '../validators';
import addPromiseSupport from '../utils/add-promise-support';

const VALIDITY_DURATION_SECONDS = 24 * 60 * 60; // 1 day

/**
 * Registration happens in 2 steps
 * 1. User send an Active RegisterAction. -> this put a token in Redis
 * 2. User send a Completed RegisterAction passing the token (typically gotten from an email (InformAction)) as instrument
 *
 * Note: setting `strict = false` allow user to skip step1
 *
 * `RegisterAction` can have a `purpose` taking an Action
 *
 * const purposes = [
 *   // register to join a journal
 *   {
 *     '@type': 'ApplyAction',
 *     agent: {
 *       roleName: 'reviewer'
 *     },
 *     object: 'journal:journalId'
 *   },
 *   // register to buy a plan
 *   {
 *     '@type': 'SubscribeAction',
 *     expectsAcceptanceOf: 'offer:scipe-explorer'
 *   },
 *   // register to submit a paper to a journal
 *   {
 *     '@type': 'CreateGraphAction',
 *     object: 'workflow:workflowId',
 *     result: {
 *       '@type': 'Graph',
 *       additionalType: 'type:typeId',
 *       isPartOf: 'journal:journalId'
 *     }
 *   }
 * ];
 *
 */

export default addPromiseSupport(function handleRegisterAction(
  action,
  {
    store,
    triggered,
    prevAction,
    tokenId, // this is handy for testing so that we don't have to grab registration email to know the tokenId
    strict = true // if set to false, user can register directly by posting a completed RegisterAction
  } = {},
  callback
) {
  // We garbage collect every time the handler is called
  deleteExpiredActiveRegisterActions.call(
    this,
    action,
    { store },
    (err, deletedActions) => {
      if (err) {
        this.log.error(
          { err, action },
          'Error for deleteExpiredActiveRegisterActions'
        );
      }

      switch (action.actionStatus) {
        case 'ActiveActionStatus':
          activateRegisterAction.call(
            this,
            action,
            {
              store,
              triggered,
              prevAction,
              tokenId,
              strict
            },
            callback
          );
          break;

        case 'CompletedActionStatus':
          completeRegisterAction.call(
            this,
            action,
            {
              store,
              triggered,
              prevAction,
              strict
            },
            callback
          );
          break;

        default:
          callback(
            createError(400, `Invalid action status for ${action['@type']}`)
          );
      }
    }
  );
});

function deleteExpiredActiveRegisterActions(action, { store } = {}, callback) {
  this.getExpiredActiveRegisterActions(
    VALIDITY_DURATION_SECONDS * 1000,
    { store },
    (err, actions) => {
      if (err) return callback(err);

      // First we delete the _user documents
      // Note: there is a bug in the Cloudant docker image preventing include_docs true to work with _all_docs on the _users DB
      this.authDb.post(
        {
          url: '/_all_docs',
          json: {
            keys: actions
              .map(action => getAgentId(action.agent))
              .map(userId => createId('user', userId)._id)
          }
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return callback(err);
          }

          this.authDb.post(
            {
              url: '/_bulk_docs',
              json: {
                docs: body.rows
                  .filter(row => row.id && row.value && row.value.rev)
                  .map(row => {
                    return { _id: row.id, _rev: row.value.rev, _deleted: true };
                  })
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return callback(err);
              }

              this.put(
                actions.map(action => flagDeleted(action)),
                { store, force: true },
                callback
              );
            }
          );
        }
      );
    }
  );
}

// Note: in strict mode, this will be called without a password during the
// completion phase of the RegisterAction, in this case we simply return the
// CouchDB user created during the ActiveActionStatus phase and error if we can't
// find it
function upsertCouchDbUser(user, password, strict, callback) {
  // There may be a previous _user doc if the garbage collection failed, in this case we overwrite it
  this.authDb.get(
    {
      url: `/${encodeURIComponent(createId('user', user['@id'])._id)}`,
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        body = undefined;
        if (err.code !== 404) {
          this.log.error(
            err,
            `Error getting previous user during RegisterAction`
          );
        }
      }

      if (!password && !body) {
        return callback(
          createError(
            400,
            'Missing password and no CouchDB user could be found'
          )
        );
      }
      if (!password) {
        return callback(null, body);
      }

      // We restrict `acl:admin` and `acl:typesetter` to `strict === false` mode
      // We use `memberOf` to allow to specify some ACL roles

      let couchAclRoles = Array.from(
        new Set(
          ['acl:user']
            .concat(arrayify(user.memberOf))
            .map(org => getId(unrole(org, 'memberOf')))
            .filter(couchRole => PUBLIC_ROLES.has(couchRole))
            .map(aclRole => unprefix(aclRole))
        )
      );
      if (strict) {
        const reservedRoles = couchAclRoles.filter(
          aclRole => aclRole === 'admin' || aclRole === 'typesetter'
        );
        if (reservedRoles.length) {
          return callback(
            createError(
              400,
              `in strict mode CouchDB role of ${reservedRoles.join(
                ','
              )} cannot be specified during RegisterAction`
            )
          );
        }
      }

      const couchDbUserData = Object.assign(
        {},
        body,
        {
          name: unprefix(getId(user)),
          type: 'user',
          password: password.value,
          email: user.email,
          roles: couchAclRoles,
          startDate: new Date().toISOString()
        },
        createId('user', getId(user))
      );

      this.authDb.put(
        {
          url: `/${encodeURIComponent(couchDbUserData._id)}`,
          json: couchDbUserData
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return callback(err);
          }
          callback(null, body);
        }
      );
    }
  );
}

/**
 * Activate a RegisterAction
 *
 * Note: that we create a document in _users a that time so that we don't need
 * to store the clear password between now and the completed RegisterAction. That
 * document is deleted if the Active RegisterAction is never completed and expires
 */
function activateRegisterAction(
  action,
  { store, triggered, prevAction, tokenId, strict } = {},
  callback
) {
  try {
    var user = getValidatedUser(action);
  } catch (err) {
    return callback(err);
  }

  // Note: password will be validated CouchDB side
  const password = arrayify(action.instrument).find(
    token => token['@type'] === 'Password'
  );

  if (!password || !password.value) {
    return callback(
      createError(
        400,
        `${
          action['@type']
        } must specify a Password as instrument (got ${password &&
          password['@type']})`
      )
    );
  }

  // validate `purpose`
  if (action.purpose) {
    const { purpose } = action;

    switch (purpose['@type']) {
      case 'ApplyAction': {
        // needs at minimum journal (`object`)
        const journalId = getObjectId(purpose);
        if (!journalId || !journalId.startsWith('journal:')) {
          return callback(
            createError(
              400,
              `${action['@type']}: invalid purpose property (invalid object)`
            )
          );
        }
        break;
      }

      case 'SubscribeAction': {
        // needs a valid offer
        const offerId = getId(purpose.expectsAcceptanceOf);
        if (
          offerId !== SCIPE_FREE_OFFER_ID &&
          offerId !== SCIPE_EXPLORER_OFFER_ID &&
          offerId !== SCIPE_VOYAGER_OFFER_ID
        ) {
          return callback(
            createError(
              400,
              `${
                action['@type']
              }: invalide purpose property (invalid expectsAcceptanceOf)`
            )
          );
        }
        break;
      }

      case 'CreateGraphAction': {
        // journal (`result.isPartOf`) may be ommited but if it is specified it must be valid
        const journalId = getRootPartId(purpose.result);
        if (journalId && !journalId.startsWith('journal:')) {
          return callback(
            createError(
              400,
              `${
                action['@type']
              }: invalide purpose property (invalid result.isPartOf)`
            )
          );
        }
        break;
      }

      default:
        return callback(
          createError(
            400,
            `${
              action['@type']
            }: invalide purpose property purpose must be a valid action`
          )
        );
    }
  }

  const actionId = createId('action', action, user);

  createRegisterLock.call(this, action, { store }, (err, lock) => {
    if (err) return callback(err);

    const token = Object.assign(createId('token', tokenId), {
      tokenType: 'registrationToken',
      instrumentOf: getId(actionId)
    });

    this.tokenStore.setex(token, VALIDITY_DURATION_SECONDS, err => {
      if (err) {
        return lock.unlock(_err => {
          if (_err) {
            this.log.error(
              { err: _err },
              'could not unlock register action lock but it will auto expire'
            );
          }
          callback(err);
        });
      }

      upsertCouchDbUser.call(
        this,
        user,
        password,
        strict,
        (err, couchDbUser) => {
          if (err) {
            return lock.unlock(_err => {
              if (_err) {
                this.log.error(
                  { err: _err },
                  'could not unlock register action lock but it will auto expire'
                );
              }
              callback(err);
            });
          }

          const handledAction = setId(
            Object.assign(omit(action, ['instrument']), {
              startTime: new Date().toISOString(),
              // overwrite agent with normalized values
              agent: user
            }),
            actionId
          );

          this.put(
            handledAction,
            { force: true, store },
            (err, handledAction) => {
              lock.unlock(_err => {
                if (_err) {
                  this.log.error(
                    { err: _err },
                    'could not unlock register action lock but it will auto expire'
                  );
                }
                if (err) {
                  return callback(err);
                }
                callback(null, handledAction);
              });
            }
          );
        }
      );
    });
  });
}

/**
 * Complete a RegisterAction and create profile
 * Note that the CouchDB _user document was already created during the ActiveActionStatus phase
 */
function completeRegisterAction(
  action,
  { store, triggered, prevAction, strict } = {},
  callback
) {
  if (strict && !prevAction) {
    return callback(
      createError(401, `An active ${action['@type']} must be issued first`)
    );
  }

  action = Object.assign(
    {},
    strict ? prevAction : prevAction || action, // if strict === false there is probably no prev action
    pick(action, ['instrument', 'actionStatus'])
  );

  let token = arrayify(action.instrument).find(
    token => token.tokenType === 'registrationToken'
  );
  if (strict && (!token || !getId(token))) {
    return callback(
      createError(400, `Missing instrument (Token) for ${action['@type']}`)
    );
  }
  if (token && getId(prevAction)) {
    // make sure that `instrumentOf` is defined so we can find the token in the `tokenStore` as token are stored using the action @id as key
    token = Object.assign({}, token, { instrumentOf: getId(prevAction) });
  }

  // In non strict mode the password is specified during that phase (as this is the only phase (no active phase))
  // In strict mode there is probably no password (that's OK)
  const password = arrayify(action.instrument).find(
    token => token['@type'] === 'Password'
  );

  // Note: if we are not in strict mode, there is probably no token in the store, that's OK
  this.tokenStore.get(token, (err, storedToken) => {
    if (strict) {
      if (err) {
        return callback(err);
      }

      if (
        getId(storedToken.instrumentOf) !== getId(action) ||
        getId(storedToken) !== getId(token)
      ) {
        return callback(
          createError(400, `Invalid Token for ${action['@type']}`)
        );
      }
    }

    try {
      var user = getValidatedUser(action);
    } catch (err) {
      return callback(err);
    }

    const profile = createProfile(user);

    createRegisterLock.call(this, action, { store }, (err, lock) => {
      if (err) return callback(err);

      upsertCouchDbUser.call(
        this,
        user,
        password,
        strict,
        (err, couchDbUser) => {
          if (err) {
            return lock.unlock(_err => {
              if (_err) {
                this.log.error(
                  { err: _err },
                  'could not unlock register action lock but it will auto expire'
                );
              }
              callback(err);
            });
          }

          reconcileActiveInviteActions.call(
            this,
            profile,
            (err, inviteActions) => {
              if (err) {
                return lock.unlock(_err => {
                  if (_err) {
                    this.log.error(
                      { err: _err },
                      'could not unlock register action lock but it will auto expire'
                    );
                  }
                  callback(err);
                });
              }

              const handledAction = setId(
                Object.assign(
                  {
                    startTime: new Date().toISOString()
                  },
                  omit(action, ['instrument']),
                  {
                    result: getId(profile),
                    endTime: new Date().toISOString()
                  }
                ),
                createId('action', action, user)
              );

              this.put(
                [handledAction, profile].concat(arrayify(inviteActions)),
                { force: true, store },
                (err, [handledAction, profile, ...inviteActions]) => {
                  lock.unlock(_err => {
                    if (_err) {
                      this.log.error(
                        { err: _err },
                        'could not unlock register action lock but it will auto expire'
                      );
                    }
                    if (err) {
                      return callback(err);
                    }

                    callback(
                      null,
                      Object.assign({}, handledAction, {
                        result: profile
                      })
                    );

                    if (strict) {
                      this.tokenStore.remove(storedToken, err => {
                        if (err) {
                          this.log.error(
                            { err, token },
                            'error deleting token, it will autoexpire'
                          );
                        }
                      });
                    }
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

function reconcileActiveInviteActions(profile, callback) {
  const email = arrayify(profile.contactPoint).find(
    cp => cp.contactType === CONTACT_POINT_ADMINISTRATION
  ).email;

  this.view.get(
    {
      url: '/inviteActionsWithoutRecipientIdByRecipientEmail',
      qs: {
        key: JSON.stringify(email),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const inviteActions = body.rows
        .filter(row => row.doc)
        .map(row => {
          const inviteAction = row.doc;
          // Note: InviteAction handler should have forced a Role for recipient
          // We are defensive just to be safe
          if (!inviteAction.recipient) {
            inviteAction.recipient = { '@type': 'ContributorRole' };
          }
          if (!inviteAction.recipient.recipient) {
            inviteAction.recipient.recipient = getId(profile);
          } else {
            inviteAction.recipient.recipient = isPlainObject(
              inviteAction.recipient.recipient
            )
              ? Object.assign({}, inviteAction.recipient.recipient, {
                  '@id': getId(profile)
                })
              : getId(profile);
          }

          // reconcile contact point by contactPointType
          if (inviteAction.recipient.roleContactPoint) {
            inviteAction.recipient.roleContactPoint = arrayify(
              inviteAction.recipient.roleContactPoint
            )
              .map(contactPoint => {
                return arrayify(profile.contactPoint).find(
                  _contactPoint =>
                    _contactPoint.contactType === contactPoint.contactType
                );
              })
              .filter(Boolean);
            if (!inviteAction.recipient.roleContactPoint.length) {
              delete inviteAction.recipient.roleContactPoint;
            }
          }

          // InviteAction can have an AdminPermission as `instrument`.
          // We resolve the grantee as well
          if (inviteAction.instrument) {
            inviteAction.instrument = dearrayify(
              inviteAction.instrument,
              arrayify(inviteAction.instrument).map(instrument => {
                if (
                  instrument.permissionType === 'AdminPermission' &&
                  instrument.grantee
                ) {
                  return Object.assign({}, instrument, {
                    grantee: getId(profile)
                  });
                }
                return instrument;
              })
            );
          }

          return inviteAction;
        });

      callback(null, inviteActions);
    }
  );
}

function createRegisterLock(registerAction, { store }, callback) {
  // note that we normalize email
  const user = getAgent(registerAction.agent);
  const userId = getId(user);
  let email = user.email.toLowerCase();
  if (!email.startsWith('mailto:')) {
    email = `mailto:${email}`;
  }

  asyncParallel(
    {
      emailLock: cb => {
        this.createLock(
          email, // !! keep in sync with `handle-update-contact-point-action.js`
          {
            prefix: 'email',
            isLocked: async () => {
              const hasUniqId = await this.hasUniqId(email);

              let activeRegisterActions;
              try {
                activeRegisterActions = await this.getActiveRegisterActionsByEmail(
                  email,
                  { store }
                );
              } catch (err) {
                if (err.code !== 404) {
                  throw err;
                }
              }

              activeRegisterActions = arrayify(activeRegisterActions);

              if (registerAction.actionStatus === 'CompletedActionStatus') {
                // filter out the active register action with the same @id as the completed one
                activeRegisterActions = activeRegisterActions.filter(
                  action => getId(action) !== getId(registerAction)
                );
              }

              let profile;
              try {
                profile = await this.getProfileByEmail(email, { store });
              } catch (err) {
                if (err.code !== 404) {
                  throw err;
                }
              }

              return hasUniqId || activeRegisterActions.length || !!profile;
            }
          },
          (err, lock) => {
            if (err) {
              err.lock = 'emailLock';
            }
            cb(err, lock);
          }
        );
      },

      userLock: cb => {
        this.createLock(
          userId,
          {
            prefix: 'user',
            isLocked: async () => {
              const hasUniqId = await this.hasUniqId(userId);

              let activeRegisterActions;
              try {
                activeRegisterActions = await this.getActiveRegisterActionByUserId(
                  userId,
                  { store }
                );
              } catch (err) {
                if (err.code !== 404) {
                  throw err;
                }
              }

              activeRegisterActions = arrayify(activeRegisterActions);

              if (registerAction.actionStatus === 'CompletedActionStatus') {
                // filter out the active register action with the same @id as the completed one
                activeRegisterActions = activeRegisterActions.filter(
                  action => getId(action) !== getId(registerAction)
                );
              }

              let profile;
              try {
                profile = await this.get(userId, { store });
              } catch (err) {
                if (err.code !== 404) {
                  throw err;
                }
              }

              return hasUniqId || activeRegisterActions.length || !!profile;
            }
          },
          (err, lock) => {
            if (err) {
              err.lock = 'userLock';
            }
            cb(err, lock);
          }
        );
      }
    },
    (err, data = {}) => {
      const locks = [data.emailLock, data.userLock].filter(Boolean);

      if (err) {
        let message;
        if (err && err.lock === 'emailLock') {
          message = `Email ${email} already taken`;
        } else if (err && err.lock === 'userLock') {
          message = `Username ${unprefix(userId)} already taken`;
        } else {
          message = (err && err.message) || 'something went wrong';
        }

        const respErr = createError(423, message);

        asyncEach(
          locks,
          (lock, cb) => {
            lock.unlock(err => {
              if (err) {
                this.log.error(
                  err,
                  'could not release lock, but it will auto expire'
                );
              }
              cb(null);
            });
          },
          err => {
            if (err) {
              this.log.error(err);
            }
            callback(respErr);
          }
        );
      } else {
        callback(null, {
          unlock(callback) {
            asyncEach(
              locks,
              (lock, cb) => {
                lock.unlock(cb);
              },
              callback
            );
          }
        });
      }
    }
  );
}

function getValidatedUser(action) {
  const user = unrole(action.agent, 'agent');
  if (!user) {
    throw createError(400, `Invalid agent for ${action['@type']}.`);
  }

  const userId = getId(user);
  const username = unprefix(userId);
  const err = validateUsername(username);
  if (err) {
    throw createError(
      400,
      (err && err.message) || `Invalid agent username for ${action['@type']}.`
    );
  }

  let email = user.email;
  if (!email || !isEmail.validate(unprefix(email))) {
    throw createError(
      400,
      `Invalid agent email for ${action['@type']} (got ${email}).`
    );
  }
  if (!email.startsWith('mailto:')) {
    email = `mailto:${email}`;
  }

  const messages = validateStylesAndAssets(user);
  if (messages.length) {
    throw createError(400, messages.join(' ; '));
  }

  return Object.assign(omit(user, ['_id', '_rev']), {
    '@id': getId(user),
    '@type': 'Person',
    email: email
  });
}
