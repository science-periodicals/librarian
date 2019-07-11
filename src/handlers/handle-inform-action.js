import url from 'url';
import { Script, createContext } from 'vm';
import ejs from 'ejs';
import pick from 'lodash/pick';
import {
  getId,
  arrayify,
  unprefix,
  getValue,
  createValue,
  unrole
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import createId from '../create-id';
import { validateInformAction, isRole } from '../validators';
import setId from '../utils/set-id';
import schema from '../utils/schema';
import {
  getObjectId,
  getObject,
  getResultId,
  getAgent,
  getAgentId,
  getRootPartId
} from '../utils/schema-utils';
import remapRole from '../utils/remap-role';
import findRole from '../utils/find-role';
import { getGraphMainEntityContributorRoles } from '../utils/role-utils';
import { CONTACT_POINT_ADMINISTRATION } from '../constants';
const script = new Script('html = ejs.render(html, data);');

/**
 * InformAction must have 1 (and 1 only) instrument that is an EmailMessage
 *
 * InformAction cannot have `participant` so that anonymity is properly preserved
 * the email text can contain leaked identities and should only be visible to `recipient`
 *
 * if `ifMatch` is set, we only execute the informAction if `ifMatch` is satisfied,
 * otherwise we simply return the action without modification
 */
export default async function handleInformAction(
  action,
  {
    store,
    triggered,
    prevAction,
    strict = true,
    referer // comes from req.headers.referer (from the API)
  } = {},
  callback
) {
  const messages = validateInformAction(action);
  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  const object = await this.get(getObjectId(action), {
    store,
    acl: false,
    potentialAction: false
  });

  if (!schema.is(object, 'Action')) {
    throw createError(
      400,
      `${action['@type']} object must be an Action or subclass thereof (got ${
        object['@type']
      })`
    );
  }

  // try to get the scope if `action.object` was defined
  const scopeId = getScopeId(object);

  let scope;
  try {
    scope = await this.get(scopeId, { acl: false, store });
  } catch (err) {
    if (err.code === 404 && object['@type'] === 'RegisterAction') {
      scope = getAgent(object.agent);
    } else {
      throw err;
    }
  }

  if (action.ifMatch) {
    // For now ifMatch is only used with `potentialResult` / `result` (ifMatch must match result)
    if (
      !arrayify(object.result).some(
        result => getId(result) === getId(action.ifMatch)
      )
    ) {
      return action;
    }
  }

  // validate agent
  let agent = action.agent || 'bot:scipe';
  const agentId = getAgentId(agent);
  if (!agentId) {
    throw createError(400, `${action['@type']} invalid agent`);
  }
  if (agentId === 'bot:scipe') {
    agent = 'bot:scipe';
  }

  const sourceAgent = findRole(agent, scope, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  // For Graphs, the agent must be a Role (so that we can preserve anonymity)
  if (!sourceAgent && agent !== 'bot:scipe' && scope['@type'] === 'Graph') {
    throw createError(
      400,
      `${action['@type']} agent must be a valid ${object['@type']} (${getId(
        scope
      )}) Role`
    );
  }

  const handledAgent = sourceAgent
    ? remapRole(sourceAgent, 'agent', { dates: false })
    : agentId;

  const handledRecipients = await this.resolveRecipients(
    action.recipient,
    scope,
    { store, strict }
  );

  // further validate `recipient` if scope is Graph
  if (scope['@type'] === 'Graph') {
    const journal = await this.get(getRootPartId(scope), {
      acl: false,
      store
    });

    const validIds = new Set(
      arrayify(scope.author)
        .concat(
          arrayify(scope.editor),
          arrayify(scope.producer),
          arrayify(scope.reviewer),
          arrayify(journal.author),
          arrayify(journal.editor),
          arrayify(journal.producer),
          arrayify(journal.reviewer),
          getGraphMainEntityContributorRoles(scope)
        )
        .map(getId)
        .filter(roleId => roleId && roleId.startsWith('role:'))
    );

    // all recipient must be roles (so we can handle blinding
    // if role have @id there must come from Graph or Journal
    // if they don't have @id they must have an email and no user @id
    if (
      !arrayify(handledRecipients).every(role => {
        const roleId = getId(role);
        const unroled = unrole(role, 'recipient');
        return (
          (isRole(role, 'recipient', {
            needRoleProp: true,
            objectType: 'Graph'
          }) ||
            isRole(role, 'recipient', {
              needRoleProp: true,
              objectType: 'Periodical'
            })) &&
          ((roleId && validIds.has(roleId)) ||
            (unroled &&
              ((getId(unroled) && getId(unroled) !== roleId) || unroled.email)))
        );
      })
    ) {
      throw createError(400, `${action['@type']}, invalid recipient`);
    }
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      // hydrate email message
      const emailMessage = arrayify(action.instrument)[0];

      let registrationToken;
      if (object && object['@type'] === 'RegisterAction') {
        try {
          registrationToken = await new Promise((resolve, reject) => {
            this.tokenStore.get(getId(object), (err, token) => {
              if (err) return reject(err);
              resolve(token);
            });
          });
        } catch (err) {
          // noop
        }
      }

      let emailVerificationToken;
      if (object && object['@type'] === 'UpdateContactPointAction') {
        try {
          emailVerificationToken = await new Promise((resolve, reject) => {
            this.tokenStore.get(getId(object), (err, token) => {
              if (err) return reject(err);
              resolve(token);
            });
          });
        } catch (err) {
          // noop
        }
      }

      let passwordResetToken;
      if (object && object['@type'] === 'ResetPasswordAction') {
        try {
          passwordResetToken = await new Promise((resolve, reject) => {
            this.tokenStore.get(getResultId(object), (err, token) => {
              if (err) return reject(err);
              resolve(token);
            });
          });
        } catch (err) {
          // noop
        }
      }

      const handledEmailMessage = await handleEmailMessage.call(this, action, {
        referer,
        object,
        scope,
        store,
        strict,
        triggered,
        registrationToken,
        emailVerificationToken,
        passwordResetToken
      });

      // send email message (only if recipient)
      if (handledEmailMessage.recipient) {
        try {
          const res = await this.sendEmail(handledEmailMessage);
          handledEmailMessage.identifier = `ses:${res.MessageId}`;
        } catch (err) {
          throw err;
        }
      }

      const handledAction = setId(
        Object.assign(
          {
            endTime: new Date().toISOString()
          },
          action,
          {
            agent: handledAgent,
            recipient: handledRecipients,
            // partialy embed as the message was hydrated so could be big
            instrument: Object.assign(
              {},
              emailMessage, // non hydrated
              pick(handledEmailMessage, [
                // subset of props that are safe (not huge size / not hydrated)
                '@id',
                '@type',
                'identifier',
                'name',
                'description',
                'text'
              ])
            )
          }
        ),
        createId('action', action, scope)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }

    default: {
      // just store the action but be sure to give an @id to the instrument
      const handledAction = setId(
        Object.assign(
          {},
          action.actionStatus !== 'PotentialActionStatus'
            ? {
                startTime: new Date().toISOString()
              }
            : undefined,
          action.actionStatus === 'StagedActionStatus'
            ? { stagedTime: new Date().toISOString() }
            : undefined,
          action.actionStatus === 'FailedActionStatus'
            ? {
                endTime: new Date().toISOString()
              }
            : undefined,
          action,
          {
            agent: handledAgent,
            recipient: handledRecipients,
            instrument: setId(
              action.instrument,
              createId('node', action.instrument, scope)
            )
          }
        ),
        createId('action', action, scope)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }
  }
}

/**
 * !! `this` needs to be a librarian instance
 */
async function handleEmailMessage(
  action,
  {
    referer,
    object, // the `object` of the InformAction
    scope = {}, // the scope of `object` (if any)
    store,
    strict,
    triggered,
    registrationToken,
    emailVerificationToken,
    passwordResetToken,
    now = new Date().toISOString()
  } = {}
) {
  let emailMessage = setId(
    Object.assign({}, arrayify(action.instrument)[0]), // create a shallow copy as we will mutate some props
    createId('node', getId(arrayify(action.instrument)[0]), scope)
  );

  // resolve recipient
  const resolvedRecipients = await this.resolveRecipients(
    emailMessage.recipient || action.recipient,
    scope,
    { store, strict }
  );
  emailMessage.recipient = resolvedRecipients;

  const nodeMap = await this.hydrate(emailMessage, {
    store,
    acl: triggered ? false : action.agent
  });

  function hydrate(node) {
    const id = getId(node);
    if (!id) {
      return node;
    }
    return id in nodeMap ? nodeMap[id] : node;
  }

  // unrolify sender and recipient so we get to the email prop
  if (emailMessage.sender) {
    let hydratedSender = hydrate(
      unrole(hydrate(emailMessage.sender), 'sender')
    );
    // we allow email overwrite so that we can have contact point update
    // verification (otherwise we always email the administrative contact point)
    if (emailMessage.sender.email) {
      hydratedSender = Object.assign({}, hydratedSender, {
        email: emailMessage.sender.email
      });
    }

    if (
      hydratedSender &&
      (hydratedSender.email ||
        arrayify(hydratedSender.contactPoint).some(cp => {
          cp = hydrate(cp);
          return (
            cp && cp.contactType === CONTACT_POINT_ADMINISTRATION && cp.email
          );
        }))
    ) {
      emailMessage.sender = hydratedSender;
    } else {
      delete emailMessage.sender;
    }
  }

  emailMessage.recipient = arrayify(emailMessage.recipient)
    .map(recipient => {
      let hydratedRecipient = hydrate(unrole(hydrate(recipient), 'recipient'));
      // we allow email overwrite so that we can have contact point update
      // verification (otherwise we always email the administrative contact point)
      if (recipient.email) {
        hydratedRecipient = Object.assign({}, hydratedRecipient, {
          email: recipient.email
        });
      }
      return hydratedRecipient;
    })
    .filter(recipient => {
      return (
        recipient &&
        (recipient.email ||
          arrayify(recipient.contactPoint).some(cp => {
            cp = hydrate(cp);
            return (
              cp && cp.contactType === CONTACT_POINT_ADMINISTRATION && cp.email
            );
          }))
      );
    });

  if (!emailMessage.recipient.length) {
    delete emailMessage.recipient;
  }

  const { text } = emailMessage;
  let html = getValue(text);

  if (text && text['@type'] === 'sa:ejs') {
    // render ejs template

    const data = {
      registrationToken,
      emailVerificationToken,
      passwordResetToken,
      object,
      emailMessage,
      getObject,
      getObjectId,
      unrole,
      getId,
      unprefix,
      arrayify,
      hydrate,
      referer,
      parsedReferer: referer ? url.parse(referer) : undefined
    };

    const sandbox = { data, html, ejs };
    const context = createContext(sandbox);
    try {
      script.runInContext(context, { timeout: 2000 });
      html = context.html;
    } catch (err) {
      throw err;
    }
  }

  if (text) {
    emailMessage.text = createValue(html);
  }

  return emailMessage;
}
