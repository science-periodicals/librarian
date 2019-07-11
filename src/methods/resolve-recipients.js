import querystring from 'querystring';
import isEmail from 'isemail';
import uniq from 'lodash/uniq';
import pick from 'lodash/pick';
import {
  unprefix,
  getId,
  arrayify,
  dearrayify,
  unrole,
  reUuid,
  getNodeMap
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import Store from '../utils/store';
import { getRootPartId, getAgentId, getAgent } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import { decrypt } from '../crypto/encrypt';
import remapRole from '../utils/remap-role';
import { COPIED_ROLE_PROPS } from '../constants';

/**
 * Resolve `recipient` (typically from `InviteAction` or `InformAction`)
 * We resolve recipient _before_ storing the action hosting them to CouchDB
 * so that we have access to query by userId.
 * => on the read side, the `anonymize` method will "reanonymize" them
 * - resolve existing role (new roles are only possible if `strict` is false)
 * - de-anonymize (see API search roles route) in case of anonymous invites
 * - try to turn email into userId
 */
export default async function resolveRecipients(
  recipients, // single recipient or list of recipients
  scope, // graph, journal, or organization (can be undefined or null)
  { store = new Store(), strict = true } = {}
) {
  if (!scope) {
    return recipients;
  }

  let journal;
  if (scope['@type'] === 'Graph') {
    const journalId = getRootPartId(scope);
    if (!journalId) {
      throw createError(
        400,
        `Could not resolve recipient ${getId(
          scope
        )}, is not part of a Periodical`
      );
    }

    journal = await this.get(journalId, {
      store,
      acl: false
    });
  }

  // prefetch data so that the fetch are efficient (batched)
  const userIds = uniq(
    arrayify(recipients)
      .map(recipient => getAgentId(recipient))
      .filter(id => id && id.startsWith('user:'))
  );

  let profiles;
  try {
    profiles = await this.get(userIds, { acl: false, store });
  } catch (err) {
    if (err.code === 404) {
      profiles = [];
    } else {
      throw err;
    }
  }
  const profileMap = getNodeMap(profiles);

  const missing = userIds.filter(userId => !(userId in profileMap));
  if (missing.length) {
    // may be pending RegisterAction
    const registerActions = await this.getActiveRegisterActionByUserId(
      missing,
      { store }
    );
    registerActions.forEach(registerAction => {
      const agent = getAgent(registerAction.agent);
      if (getId(agent)) {
        profileMap[getId(agent)] = agent;
      }
    });
  }

  const emails = uniq(
    arrayify(recipients)
      .map(recipient => getAgent(recipient))
      .filter(agent => agent && agent.email)
      .map(agent => {
        const { email } = agent;
        return email.startsWith('mailto:') ? email : `mailto:${email}`;
      })
  );

  let reconciledProfiles;
  try {
    reconciledProfiles = await this.getProfileByEmail(emails, { store });
  } catch (err) {
    if (err.code === 404) {
      reconciledProfiles = [];
    } else {
      throw err;
    }
  }

  const reconciledProfilesByEmails = reconciledProfiles.reduce(
    (map, profile) => {
      arrayify(profile.contactPoint).forEach(cp => {
        if (cp.email) {
          map[cp.email] = profile;
        }
      });

      return map;
    },
    {}
  );

  const resolvedRecipients = arrayify(recipients).map(recipient => {
    const recipientId = getId(recipient);

    if (recipientId) {
      if (recipientId.startsWith('role:')) {
        // validate role: must be present in scope or journal (in strict mode) and can be a new role (but must be UUID in non strict mode)
        let scopeRole = findRole(recipient, scope, {
          strict: true,
          ignoreEndDateOnPublicationOrRejection: true
        });
        if (!scopeRole && journal) {
          scopeRole = findRole(recipient, journal, {
            strict: true,
            ignoreEndDateOnPublicationOrRejection: true
          });
        }

        if (!scopeRole) {
          if (strict) {
            throw createError(
              400,
              `${recipientId} cannot be found in ${getId(scope)}${
                journal ? ` or ${getId(journal)}` : ''
              }`
            );
          } else {
            if (!reUuid.test(unprefix(recipientId))) {
              throw createError(400, `${recipientId} must be a uuid V4`);
            }
            scopeRole = recipient;
          }
        }

        return remapRole(scopeRole, 'recipient', { dates: false });
      } else if (recipientId.startsWith('anon:')) {
        // anonymous role case
        if (!journal || !scope.encryptionKey) {
          throw createError(
            400,
            `Could not resolve recipient ${recipientId}, no journal or encryption could be found for ${getId(
              scope
            )}`
          );
        }

        const [encryptedId, qs] = unprefix(recipientId).split('?');
        const { graph: unprefixedGraphId } = querystring.parse(qs);
        if (unprefixedGraphId !== unprefix(getId(scope))) {
          throw createError(
            400,
            `Invalid recipient, anonymized ${encryptedId} role 'graph' query string parameter doesn't match with the object ${getId(
              scope
            )}`
          );
        }

        const roleId = decrypt(encryptedId, scope.encryptionKey);

        const decryptedRole = findRole(roleId, journal, {
          strict: true,
          ignoreEndDateOnPublicationOrRejection: true
        });
        if (!decryptedRole) {
          throw createError(
            400,
            `Invalidrecipient, anonymized ${encryptedId} role cannot be found in ${getId(
              journal
            )}`
          );
        }

        return remapRole(decryptedRole, 'recipient', { dates: false });
      } else if (recipientId.startsWith('user:')) {
        const profile = profileMap[recipientId];
        if (!profile) {
          throw createError(
            400,
            `Invalid recipient ${recipientId}. Recipient must be a registered user`
          );
        }

        return recipientId;
      } else {
        throw createError(
          400,
          `Could not resolve recipient: invalid recipient @id (got ${recipientId})`
        );
      }
    } else {
      // no top level @id case
      if (recipient.recipient) {
        // new role case

        // we need a user: @id or an email
        const unroled = unrole(recipient, 'recipient');
        if (!unroled) {
          throw createError(
            400,
            `Invalid recipient. No @id and cannot be unroled`
          );
        }

        const unroledId = getId(unroled);
        if (unroledId) {
          if (unroledId.startsWith('user:')) {
            const profile = profileMap[unroledId];
            if (!profile) {
              throw createError(
                400,
                `Invalid recipient ${recipientId}. Recipient must be a registered user`
              );
            }

            return Object.assign(pick(recipient, COPIED_ROLE_PROPS), {
              recipient: unroledId
            });
          } else {
            throw createError(
              400,
              `Could not resolve recipient: invalid recipient @id (got ${unroledId})`
            );
          }
        } else if (unroled.email) {
          if (unroled.email in reconciledProfilesByEmails) {
            return Object.assign(pick(recipient, COPIED_ROLE_PROPS), {
              recipient: getId(reconciledProfilesByEmails[unroled.email])
            });
          }

          if (!isEmail.validate(unprefix(unroled.email))) {
            throw createError(
              400,
              `Invalid recipient email for ${unroled.email}.`
            );
          }

          return Object.assign(pick(recipient, COPIED_ROLE_PROPS), {
            recipient: Object.assign(pick(unroled, ['@type']), {
              email: `mailto:${unprefix(unroled.email)}`
            })
          });
        } else {
          throw createError(
            400,
            `Could not resolve recipient: no @id or email`
          );
        }
      } else {
        // user case (and no @id was specified => we need an email
        if (recipient.email) {
          if (recipient.email in reconciledProfilesByEmails) {
            return getId(reconciledProfilesByEmails[recipient.email]);
          }

          if (!isEmail.validate(unprefix(recipient.email))) {
            throw createError(
              400,
              `Invalid recipient email for ${recipient.email}.`
            );
          }

          return Object.assign(pick(recipient, ['@type']), {
            email: `mailto:${unprefix(recipient.email)}`
          });
        } else {
          throw createError(
            400,
            `Could not resolve recipient: no @id or email`
          );
        }
      }
    }
  });

  return dearrayify(recipients, resolvedRecipients);
}
