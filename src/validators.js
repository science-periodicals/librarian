import isEqual from 'lodash/isEqual';
import isPlainObject from 'lodash/isPlainObject';
import moment from 'moment';
import {
  getId,
  arrayify,
  unrole,
  unprefix,
  context,
  getNodeMap
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import {
  JOURNAL_COMMENT_IDENTIFIERS_SET,
  EMAIL_MESSAGE_SENDER,
  CSS_VARIABLE_NAMES_SET,
  ASSET_LOGO_NAMES_SET,
  ASSET_IMAGE_NAMES_SET,
  ASSET_AUDIO_NAMES_SET,
  ASSET_VIDEO_NAMES_SET
} from './constants';
import reEmail from 'regex-email';
import { getSourceRoleId, parseRoleIds } from './utils/role-utils';
import schema from './utils/schema';
import findRole from './utils/find-role';
import remapRole from './utils/remap-role';
import { getAgentId, getParts } from './utils/schema-utils';
import createId from './create-id';

/**
 * object is an Action, Event, CreativeWork, WorkflowSpecification or Role
 */
export function validateDateTimeDuration(object = {}) {
  const messages = [];

  if (isPlainObject(object)) {
    // ISO 8601 DateTime
    const tProps = [
      // Actions
      'startTime',
      'endTime',
      'scheduledTime',
      // Roles
      'startDate',
      'endDate',
      // CreativeWork
      'dateCreated',
      'dateModified',
      'datePublished',
      'dateRejected',
      'dateDeleted'
    ];
    tProps.forEach(prop => {
      if (prop in object) {
        const dateTime = object[prop];
        if (!moment(dateTime, moment.ISO_8601).isValid()) {
          messages.push(
            `Invalid ${prop}: ${prop} must be a valid ISO 8601 date`
          );
        }
      }
    });

    // ISO 8601 Duration
    const dProps = [
      // Event
      'duration',
      // Action
      'expectedDuration',
      // ServiceChannel
      'processingTime'
    ];
    dProps.forEach(prop => {
      if (prop in object) {
        const duration = object[prop];
        const parsedDuration = moment.duration(duration).toISOString();
        if (parsedDuration !== duration) {
          messages.push(
            `Invalid ${prop}: ${prop} must be a valid ISO 8601 duration. Parsing the value resulted in: ${parsedDuration}`
          );
        }
      }
    });

    // ISO 8601 time interval
    const iProps = ['temporalCoverage'];
    iProps.forEach(prop => {
      if (prop in object) {
        const coverage = object[prop];
        if (typeof coverage !== 'string') {
          messages.push(
            `Invalid ${prop}: ${prop} must be a valid ISO 8601 time interval.`
          );
        } else {
          const [starts, ends] = coverage.split('/', 2);

          if (
            !moment(starts, moment.ISO_8601).isValid() ||
            !moment(ends, moment.ISO_8601).isValid() ||
            !moment(starts).isBefore(ends)
          ) {
            messages.push(
              `Invalid ${prop}: ${prop} must be a valid ISO 8601 time interval.`
            );
          }
        }
      }
    });
  }

  return messages;
}

/**
 * see http://schema.org/PriceSpecification for all subtypes
 */
export function validatePriceSpecification(priceSpecification) {
  let messages = [];
  if (!priceSpecification) return messages;

  const type = priceSpecification['@type'] || 'PriceSpecification';

  switch (type) {
    case 'PriceSpecification':
    case 'UnitPriceSpecification':
    case 'DeliveryChargeSpecification':
    case 'PaymentChargeSpecification': {
      const { price, priceCurrency } = priceSpecification;
      if (typeof price !== 'number') {
        messages.push('Invalid priceSpecification: price is not a number.');
      }
      if (typeof priceCurrency !== 'string') {
        messages.push('Invalid priceSpecification: invalid priceCurrency.');
      }
      break;
    }

    case 'CompoundPriceSpecification':
      arrayify(priceSpecification.priceComponent).forEach(priceComponent => {
        messages = messages.concat(validatePriceSpecification(priceComponent));
      });
      break;
  }

  // `valueAddedTaxIncluded` and `platformFeesIncluded` must be defined and `false`
  if (priceSpecification.valueAddedTaxIncluded !== false) {
    messages.push(
      'PriceSpecification: valueAddedTaxIncluded must be defined and set to false'
    );
  }
  if (priceSpecification.platformFeesIncluded !== false) {
    messages.push(
      'PriceSpecification: platformFeesIncluded must be defined and set to false'
    );
  }

  return messages;
}

export function validateOffer(offer) {
  const messages = [];
  if (offer['@type'] !== 'Offer') {
    messages.push('Invalid @type for offer');
  }
  if (offer.priceSpecification) {
    messages.push(...validatePriceSpecification(offer.priceSpecification));
  } else {
    messages.push('Offer need a valid price specification');
  }
  if (
    offer.eligibleCustomerType &&
    offer.eligibleCustomerType !== 'RevisionAuthor'
  ) {
    messages.push(
      `Offer: invalid "eligibleCustomerType" property, value must be "RevisionAuthor" (got ${offer.eligibleCustomerType})`
    );
  }

  if (offer.addOn) {
    messages.push(...validateOffer(offer.addOn));
  }

  return messages;
}

export function validateCustomers(
  action = {},
  scope // Graph or Periodical
) {
  const messages = [];

  const customers = arrayify(action.participant).filter(
    participant => participant.roleName === 'customer'
  );

  if (
    customers.some(customer => {
      // return true for invalid customer
      const roleId = getId(customer);
      if (!roleId || !roleId.startsWith('srole:')) {
        return true;
      }

      const sourceRole = findRole(getSourceRoleId(roleId), scope);
      if (!sourceRole) {
        return true;
      }

      return false;
    })
  ) {
    messages.push(
      `Invalid action participant, customer(s) must be  present in the ${
        scope['@type']
      }.`
    );
  }

  return messages;
}

export function isRole(
  role = {},
  roleProp,
  { needRoleProp = false, objectType = 'any' } = {}
) {
  let hasRoleProp;
  if (!roleProp) {
    hasRoleProp = !!(
      role.agent ||
      role.recipient ||
      role.participant ||
      role.creator ||
      role.author ||
      role.contributor ||
      role.producer ||
      role.editor ||
      role.sender ||
      role.accountablePerson ||
      role.copyrightHolder ||
      role.director ||
      role.illustrator ||
      role.knows ||
      role.publishedBy ||
      role.reviewedBy ||
      role.sibling ||
      role.spouse ||
      role.translator
    );
  } else {
    hasRoleProp = !!role[roleProp];
  }

  // @type is optional but if it is set must be valid
  const typeOK = !role['@type'] || schema.is(role, 'Role');
  const rolePropOK = needRoleProp ? hasRoleProp : true;

  // `roleName` is required
  switch (objectType) {
    case 'Graph':
    case 'Periodical':
      return (
        typeOK &&
        rolePropOK &&
        typeof role.roleName === 'string' &&
        /^(editor|author|reviewer|producer|contributor)$/.test(role.roleName)
      );

    case 'Organization':
      return (
        typeOK &&
        rolePropOK &&
        typeof role.roleName === 'string' &&
        /^(administrator|producer)$/.test(role.roleName)
      );

    default:
      return (
        typeOK &&
        rolePropOK &&
        typeof role.roleName === 'string' &&
        /^(audience|editor|author|reviewer|producer|user|assigner|unassigner|subscriber|participant|endorser|customer|member|administrator)$/.test(
          role.roleName
        )
      );
  }
}

export function isAudience(audience = {}) {
  return (
    audience['@type'] === 'Audience' &&
    /^(editor|author|reviewer|producer|user|public)$/.test(
      audience.audienceType
    )
  );
}

export function hasId(obj = {}) {
  return typeof obj === 'string' || typeof obj['@id'] === 'string';
}

export function validateDigitalDocumentPermission(
  permission,
  { validGranteeIds } = {}
) {
  // no need for permissionScope
  const unscopedPermissions = new Set([
    'CreateGraphPermission',
    'ReadPermission',
    'WritePermission',
    'AdminPermission'
  ]);

  // need permissionScope with audience of [ "user", "author", "editor", "reviewer", "producer" ]
  const scopedPermissions = new Set(['ViewIdentityPermission']);

  const permissions = arrayify(permission);

  let invalidType;
  let invalidGrantee;
  const invalidPermissionTypes = [];
  const invalidUnscopedPermissions = [];
  const invalidScopedPermissions = [];

  permissions.forEach(permission => {
    if (permission['@type'] !== 'DigitalDocumentPermission') {
      invalidType = true;
    }

    // invalid Grantee
    if (
      !permission.grantee ||
      arrayify(permission.grantee).some(grantee => {
        const granteeId = getAgentId(grantee);
        // we allow grantee to be a user
        if (granteeId && granteeId.startsWith('user:')) {
          // grantee is a user
          if (validGranteeIds) {
            if (validGranteeIds.has(granteeId)) {
              return false; // valid
            } else {
              return true; // invalid
            }
          }
          return false; // valid
        }

        // validate audience (invalid audience cases)
        return (
          grantee['@type'] !== 'Audience' ||
          !grantee.audienceType ||
          !/^public$|^user$|^editor$|^author$|^reviewer$|^producer$/.test(
            grantee.audienceType
          )
        );
      })
    ) {
      invalidGrantee = true;
    }

    if (unscopedPermissions.has(permission.permissionType)) {
      if (permission.permissionScope) {
        invalidUnscopedPermissions.push(permission);
      }
    } else if (scopedPermissions.has(permission.permissionType)) {
      if (
        !permission.permissionScope ||
        arrayify(permission.permissionScope).some(scope => {
          return (
            scope['@type'] !== 'Audience' ||
            !scope.audienceType ||
            !/^public$|^user$|^editor$|^author$|^reviewer$|^producer$/.test(
              scope.audienceType
            )
          );
        })
      ) {
        invalidScopedPermissions.push(permission);
      }
    } else {
      invalidPermissionTypes.push(permission.permissionType);
    }
  });

  const errMsgs = [];
  if (invalidType) {
    errMsgs.push(
      'each permission must have a @type of DigitalDocumentPermission'
    );
  }
  if (invalidGrantee) {
    errMsgs.push(
      'each permission must have a grantee property taking a valid Audience or user (or list thereof) as value'
    );
  }
  if (invalidPermissionTypes.length) {
    errMsgs.push(
      `the permissionType property must take one of the following value: ${Array.from(
        unscopedPermissions
      )
        .concat(Array.from(scopedPermissions))
        .join(', ')} (got: ${invalidPermissionTypes.join(', ')})`
    );
  }
  if (invalidUnscopedPermissions.length) {
    errMsgs.push(
      `the following permissions cannot have a permissionScope property: ${invalidUnscopedPermissions
        .map(p => p.permissionType)
        .join(', ')}`
    );
  }
  if (invalidScopedPermissions.length) {
    errMsgs.push(
      `the following permissions must have a valid permissionScope property taking an audience (or list therof) as value: ${invalidScopedPermissions
        .map(p => p.permissionType)
        .join(', ')}`
    );
  }

  if (errMsgs.length) {
    throw createError(400, `Errors: ${errMsgs.join('; ')}`);
  }
}

/**
 * - InformAction cannot have `participant` so that anonymity is properly
 *   preserved the email text can contain leaked identities and should only be
 *   visible to `recipient`
 * - recipient can be a list of role or user. When @id are not
 *   specified, an `email` prop must be
 * - instrument must be an email message and the recipient of the
 *   email message must be a subset of the recipient of the `informAction`
 */
export function validateInformAction(informAction = {}) {
  const messages = [];

  if (
    informAction.actionStatus !== 'PotentialActionStatus' &&
    informAction.actionStatus !== 'CompletedActionStatus' &&
    informAction.actionStatus !== 'CanceledActionStatus' &&
    informAction.actionStatus !== 'FailedActionStatus'
  ) {
    messages.push(
      `InformAction must have an actionStatus property of value PotentialActionStatus, CompletedActionStatus, CanceledActionStatus or FailedActionStatus (got ${informAction.actionStatus})`
    );
  }

  // No participants
  if (informAction.participant) {
    messages.push('InformAction cannot have a participant property');
  }

  // validate recipient
  // + we need to ensure that when defined, email message recipients are a
  // subset of informAction.recipient
  const [recipientErrors, recipientIds] = _validateRecipients(
    informAction.recipient
  );
  messages.push(...recipientErrors);

  const instruments = arrayify(informAction.instrument);
  if (instruments.length !== 1) {
    messages.push(
      `Invalid instrument for InformAction (${getId(emailMessage) ||
        'unspecified @id'}). InformAction must have exactly 1 instrument (EmailMessage)`
    );
  }

  const emailMessage = instruments[0];
  if (!emailMessage || emailMessage['@type'] !== 'EmailMessage') {
    messages.push(
      `Invalid instrument for InformAction (${getId(emailMessage) ||
        'unspecified @id'}). Instrument must be of @type EmailMessage`
    );
  }

  // sender
  if (
    emailMessage.sender &&
    emailMessage.sender.email &&
    emailMessage.sender.email !== `mailto:${EMAIL_MESSAGE_SENDER}`
  ) {
    messages.push(
      `Invalid EmailMessage (${getId(emailMessage) ||
        'unspecified @id'}) for InformAction (${getId(emailMessage) ||
        'unspecified @id'}), when defined, sender property must have an email value set to "mailto:${EMAIL_MESSAGE_SENDER}" (got ${
        emailMessage.sender.email
      }).`
    );
  }

  // emailMessage recipients
  const [emailRecipientErrors, emailRecipientIds] = _validateRecipients(
    emailMessage.recipient
  );
  messages.push(...emailRecipientErrors);

  // ensure that email recipients are a subset of inform action recipient:
  const invalidIds = Array.from(emailRecipientIds).filter(
    id => !recipientIds.has(id)
  );

  if (invalidIds.length) {
    messages.push(
      `Invalid EmailMessage (${getId(emailMessage) ||
        'unspecified @id'}) for InformAction (${getId(emailMessage) ||
        'unspecified @id'}). Email message recipient must be a subset or equal to the inform action recipient (got ${invalidIds.join(
        ', '
      )}).`
    );
  }

  return messages;
}

function _validateRecipients(recipients) {
  const recipientIds = new Set();
  const messages = [];
  arrayify(recipients).forEach(role => {
    const roleId = getId(role);

    // validate roleId
    let hasId = false;
    if (roleId) {
      if (
        roleId.startsWith('role:') ||
        roleId.startsWith('user:') ||
        roleId.startsWith('anon:')
      ) {
        hasId = true;
        recipientIds.add(roleId);
      } else {
        messages.push(`Invalid recipient ${roleId} for InformAction`);
      }
    }

    if (role.recipient) {
      const unroled = unrole(role, 'recipient');
      const unroledId = getId(unroled);
      if (unroledId) {
        if (unroledId.startsWith('user:')) {
          hasId = true;
          recipientIds.add(unroledId);
        } else {
          messages.push(
            `Invalid unroled recipient ${unroledId} for InformAction`
          );
        }
      }

      if (unroled.email) {
        if (reEmail.test(unprefix(unroled.email))) {
          hasId = true;
          recipientIds.add(unroled.email);
        } else {
          messages.push(
            `Invalid recipient for InformAction. When defined, recipient email property must be a valid email address (got ${unroled.email}).`
          );
        }
      }
    } else {
      // only the top level `role` (which can be an user)
      if (role.email) {
        if (reEmail.test(unprefix(role.email))) {
          hasId = true;
          recipientIds.add(role.email);
        } else {
          messages.push(
            `Invalid recipient for InformAction. When defined, recipient email property must be a valid email address (got ${role.email}).`
          );
        }
      }
    }

    if (!hasId) {
      messages.push(
        `Invalid recipient for InformAction, no id or email could be found`
      );
    }
  });

  return [messages, recipientIds];
}

/**
 * validate the update payload of an object action with an `OverwriteMergeStrategy`
 */
export function validateOverwriteUpdate(
  object,
  upd,
  selector,
  {
    immutableProps = [],
    arrayProps = [] // a list of props allow to take array as values although they are not defined as @set or @list in the context
  }
) {
  const messages = [];

  if (
    selector &&
    (typeof selector.selectedProperty !== 'string' || selector.hasSubSelector)
  ) {
    messages.push(
      'Invalid selector, selector cannot have a hasSubSelector property and must have a defined selectedProperty'
    );
  } else if (selector) {
    // Update a given property (and possibly a value within that prop if that prop is a list)
    const prop = selector.selectedProperty;

    if (Array.isArray(object)) {
      if (!arrayProps.includes(prop)) {
        const ctx = context['@context'][prop];
        if (
          !ctx ||
          !ctx['@container'] ||
          !(ctx['@container'] === '@list' || ctx['@container'] === '@set')
        ) {
          messages.push(
            `Invalid update payload ${prop} value cannot be an array`
          );
        }
      }
    } else {
      // validate dates
      messages.push(...validateDateTimeDuration({ [prop]: upd }));
    }

    if (immutableProps.includes(prop)) {
      const valueId = getId(selector.node);
      const value = valueId
        ? arrayify(object[prop]).find(value => getId(value) === valueId)
        : object[prop];

      if (value != null && !isEqual(value, upd)) {
        messages.push(
          `UpdateAction cannot be used to update the following property: ${prop}`
        );
      }
    }
  } else {
    // Update the root `object`
    if (
      !isPlainObject(upd) &&
      !(typeof upd === 'string' && upd.startsWith('action:'))
    ) {
      messages.push(
        'Invalid update payload (not a plain object or the @id of an UploadAction)'
      );
    }

    if (isPlainObject(upd)) {
      // validate dates
      messages.push(...validateDateTimeDuration(upd));

      // validate list
      const listProps = Object.keys(upd).filter(
        key => key !== '@graph' && Array.isArray(upd[key])
      );
      const invalidListProps = listProps.filter(prop => {
        if (!arrayProps.includes(prop)) {
          const ctx = context['@context'][prop];
          return (
            !ctx ||
            !ctx['@container'] ||
            !(ctx['@container'] === '@list' || ctx['@container'] === '@set')
          );
        }
      });

      if (invalidListProps.length) {
        messages.push(
          `Update payload contains key that cannot be arrays: ${invalidListProps.join(
            ', '
          )}`
        );
      }

      const forbiddenKeys = Object.keys(upd).filter(key => {
        return (
          immutableProps.includes(key) &&
          object[key] != null &&
          !isEqual(object[key], upd[key])
        );
      });

      if (forbiddenKeys.length) {
        messages.push(
          `UpdateAction cannot be used to update the following properties: ${forbiddenKeys.join(
            ', '
          )}`
        );
      }
    }
  }

  return messages;
}

export function validateImmutableProps(immutableProps, object, prevObject) {
  const messages = [];
  if (!prevObject) {
    return messages;
  }

  arrayify(immutableProps).forEach(p => {
    if (p in object && !isEqual(prevObject[p], object[p])) {
      messages.push(`${p} cannot be mutated`);
    }
  });

  return messages;
}

export function ensureAgentCompliance(
  agent,
  scope, // Graph, Periodical or Organization,
  {
    roleProp = 'agent',
    dates = false,
    ignoreEndDateOnPublicationOrRejection,
    now
  } = {}
) {
  const sourceAgent = findRole(agent, scope, {
    ignoreEndDateOnPublicationOrRejection,
    now
  });
  if (!sourceAgent) {
    const { userId, roleId } = parseRoleIds(agent);

    throw createError(
      400,
      `Invalid agent ${roleId ||
        userId}, ${roleProp} could not be found in ${getId(scope)} (${
        scope['@type']
      })`
    );
  }

  return remapRole(sourceAgent, roleProp, { dates });
}

/**
 * Makes sure that `style`, `logo`, `image` etc. have the right values
 */
export function validateStylesAndAssets(
  doc // profile, org, journal, graph or service
) {
  const messages = [];

  const vMap = {
    style: { type: 'CssVariable', names: CSS_VARIABLE_NAMES_SET },
    logo: { type: 'Image', names: ASSET_LOGO_NAMES_SET },
    image: { type: 'Image', names: ASSET_IMAGE_NAMES_SET },
    audio: { type: 'Audio', names: ASSET_AUDIO_NAMES_SET },
    video: { type: 'Video', names: ASSET_VIDEO_NAMES_SET }
  };

  Object.keys(vMap).forEach(p => {
    if (doc[p]) {
      arrayify(doc[p]).forEach(node => {
        if (!node['@type'] || node['@type'] !== vMap[p].type) {
          messages.push(
            `Invalid ${p} entry for ${getId(doc)}: @type should be ${
              vMap[p].type
            } (got ${node['@type']})`
          );
        }

        // validate `name` and unicity
        if (!node.name || !vMap[p].names.has(node.name)) {
          messages.push(`Invalid ${p} name ${node.name} for ${getId(doc)}`);
        }

        if (
          arrayify(doc[p]).filter(_node => _node.name === node.name).length > 1
        ) {
          messages.push(
            `Invalid ${p} for ${getId(doc)} another entry with name ${
              node.name
            } already exists`
          );
        }

        // nodeId is optional but if defined must be conform to `createId`
        const nodeId = getId(node);
        if (nodeId != null) {
          let id;
          try {
            id = createId('node', nodeId);
          } catch (err) {
            // noop
          }
          if (!id || id['@id'] !== nodeId) {
            messages.push(
              `Invalid ${p} value for ${getId(doc)}  expected ${getId(
                id
              )} (got ${nodeId})`
            );
          }
        }

        if (getId(node.isNodeOf) !== getId(doc)) {
          messages.push(
            `Invalid ${p} value for ${getId(
              doc
            )}, isNodeOf should be set to ${getId(doc)} (got ${getId(
              node.isNodeOf
            )})`
          );
        }

        // validate encodings
        arrayify(node.encoding).forEach(encoding => {
          const encodingId = getId(encoding);
          if (encodingId != null) {
            let id;
            try {
              id = createId('node', encodingId);
            } catch (err) {
              // noop
            }
            if (!id || id['@id'] !== encodingId) {
              messages.push(
                `Invalid ${p}.encoding value for ${getId(doc)} expected ${getId(
                  id
                )} (got ${encodingId})`
              );
            }
          }

          if (getId(encoding.encodesCreativeWork) !== getId(node)) {
            messages.push(
              `Invalid ${p}.encoding value for ${getId(
                doc
              )}, encodesCreativeWork should be set to ${getId(
                node
              )} (got ${getId(encoding.encodesCreativeWork)})`
            );
          }

          if (getId(encoding.isNodeOf) !== getId(doc)) {
            messages.push(
              `Invalid ${p}.encoding value for ${getId(
                doc
              )}, isNodeOf should be set to ${getId(doc)} (got ${getId(
                encoding.isNodeOf
              )})`
            );
          }

          // validate thumbnails
          arrayify(encoding.thumbnail).forEach(thumbnail => {
            const thumbnailId = getId(thumbnail);
            if (thumbnailId != null) {
              let id;
              try {
                id = createId('node', thumbnailId);
              } catch (err) {
                // noop
              }
              if (!id || id['@id'] !== thumbnailId) {
                messages.push(
                  `Invalid ${p}.encoding.thumbnail value for ${getId(
                    doc
                  )} @id expected ${getId(id)} (got ${thumbnailId})`
                );
              }
            }

            if (getId(thumbnail.encodesCreativeWork) !== getId(node)) {
              messages.push(
                `Invalid ${p}.encoding.thumbnail value for ${getId(
                  doc
                )}, encodesCreativeWork should be set to ${getId(
                  node
                )} (got ${getId(thumbnail.encodesCreativeWork)})`
              );
            }

            if (getId(thumbnail.isNodeOf) !== getId(doc)) {
              messages.push(
                `Invalid ${p}.encoding.thumbnail value for ${getId(
                  doc
                )}, isNodeOf should be set to ${getId(doc)} (got ${getId(
                  thumbnail.isNodeOf
                )})`
              );
            }
          });
        });
      });
    }
  });

  return messages;
}

export function validateJournalComments(journal) {
  const messages = [];
  arrayify(journal.comment).forEach(comment => {
    // validate `identifier` and unicity
    if (
      !comment.identifier ||
      !JOURNAL_COMMENT_IDENTIFIERS_SET.has(comment.identifier)
    ) {
      messages.push(`Invalid comment identifier ${comment.identifier}`);
    }

    if (
      arrayify(journal.comment).filter(
        _comment => _comment.identifier === comment.identifier
      ).length > 1
    ) {
      messages.push(
        `Invalid comment another entry with identifier ${comment.identifier} already exists`
      );
    }
  });
  return messages;
}

export function validateGraphNodes(graph) {
  const messages = [];

  const nodes = arrayify(graph['@graph']);

  // Validate mainEntity, resources and their encodings
  const mainEntityId = getId(graph.mainEntity);
  if (mainEntityId) {
    if (!mainEntityId.startsWith('node:')) {
      messages.push(
        `mainEntity @id must be a node: CURIE (got ${mainEntityId}). To get a node: CURIE, set the @id of the mainEntity node to a blank node @id and add a isNodeOf property pointing to ${getId(
          graph
        )})`
      );
    }

    const nodeMap = getNodeMap(graph);
    const parts = [nodeMap[mainEntityId]].concat(
      getParts(mainEntityId, nodeMap)
    );

    // part (resources) and their encodings must be on the node: CURIE and have defined `isNodeOf`
    parts.forEach(part => {
      const partId = getId(part);
      if (!partId || !partId.startsWith('node:')) {
        messages.push(
          `resource node @id must be a node: CURIE. To get a node: CURIE, set the @id of the node to a blank node @id and add a isNodeOf property pointing to ${getId(
            graph
          )} (got ${getId(part.isNodeOf)})`
        );
      }

      if (getId(part.isNodeOf) !== getId(graph)) {
        messages.push(
          `resource node @id ${getId(
            part
          )} must have a isNodeOf property pointing to ${getId(
            graph
          )} (got ${getId(part.isNodeOf)})`
        );
      }

      // encodings
      arrayify(part.encoding)
        .concat(arrayify(part.distribution))
        .forEach(encodingId => {
          encodingId = getId(encoding);
          const encoding = nodeMap[encodingId];
          if (encoding) {
            const thumbnails = arrayify(encoding.thumbnail)
              .map(thumbnailId => nodeMap[getId(thumbnailId)])
              .filter(Boolean);

            [encoding].concat(thumbnails).forEach(node => {
              const nodeId = getId(node);

              if (!nodeId.startsWith('node:')) {
                `encoding node @id ${nodeId} must be a node: CURIE. To get a node: CURIE, set the @id of the node to a blank node @id and add a isNodeOf property pointing to ${getId(
                  graph
                )}`;
              }

              if (getId(node.isNodeOf) !== getId(graph)) {
                messages.push(
                  `encoding node @id ${nodeId} must have a isNodeOf property pointing to ${getId(
                    graph
                  )} (got ${getId(node.isNodeOf)})`
                );
              }

              if (getId(node.encodesCreativeWork) !== getId(part)) {
                messages.push(
                  `encoding node @id ${nodeId} must have a encodesCreativeWork property pointing to ${getId(
                    part
                  )} (got ${getId(node.encodesCreativeWork)})`
                );
              }
            });
          }
        });
    });
  }

  nodes.forEach(node => {
    // validate other encodings: just check that `encodesCreativeWork` makes sense
    if (
      schema.is(node['@type'], 'MediaObject') ||
      node.contentUrl ||
      node.contentSize != null
    ) {
      const creativeWork = nodes.find(_node => {
        const encodings = arrayify(_node.encoding).concat(
          arrayify(_node.distribution)
        );
        return encodings.some(encodingId => encodingId === getId(node));
      });

      if (
        getId(creativeWork) &&
        getId(node.encodesCreativeWork) !== getId(creativeWork)
      ) {
        messages.push(
          `Invalid encoding ${getId(
            node
          )}, encodesCreativeWork should be ${getId(creativeWork)} (got ${getId(
            node.encodesCreativeWork
          )})`
        );
      }
    }
  });

  return messages;
}

export function validateParticipantsRestrictedToAuthorsAndProducers(
  participants,
  scope
) {
  const messages = [];

  if (participants) {
    // for live graph, participant must be restricted to authors and producers to guarantee that they have access to author identity
    const validIds = new Set(
      arrayify(scope.author)
        .concat(arrayify(scope.contributor), arrayify(scope.producer))
        .map(getId)
        .filter(roleId => roleId && roleId.startsWith('role:'))
    );

    if (
      !arrayify(participants).every(participant => {
        const roleId = getSourceRoleId(participant);
        const unroled = unrole(participant, 'participant');
        return (
          (roleId && validIds.has(roleId)) ||
          (unroled &&
            (unroled.audienceType === 'author' ||
              unroled.audienceType === 'producer'))
        );
      })
    ) {
      messages.push(
        'only authors and producers (or audiences) can be listed as participants'
      );
    }
  }

  return messages;
}
