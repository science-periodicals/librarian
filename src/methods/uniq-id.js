import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getDbName } from '../low';
import { CONTACT_POINT_ADMINISTRATION } from '../constants';
import getScopeId from '../utils/get-scope-id';

// Those methods are here to work around CouchDB 2.x lack of consistency.
// Due to the clustered nature of CouchDB 2.x PUTing a doc to the DB and
// immediately GETing it may result in a 404
// => it is not possible to ensure unicity with lock + CouchDB alone.
// => we use a set in redis to keep track of all the uniq ids
// uniq id are added (and removed) to (from) the set during librarian.put calls

export function hasUniqId(id, callback) {
  const key = `${getDbName(this.config)}:uid`;
  this.redis.sismember(key, id, (err, res) => {
    if (err) {
      return callback(createError(500, err));
    }

    callback(null, !!res);
  });
}

/**
 * This is a hack to be able to bullet proof the SubscribeAction handler lock
 */
export function hasActiveSubscribeActionId(organizationId, callback) {
  const virtualId = createVitualActiveSubscribeActionId(organizationId);
  this.hasUniqId(virtualId, callback);
}

/**
 * This is a hack to be able to bullet proof the
 * `getStripeCustomerByOrganizationId` view and locks related to stripe customers
 */
export function hasCreateCustomerAccountActionId(organizationId, callback) {
  const virtualId = createVitualCreateCustomerAccountActionId(organizationId);
  this.hasUniqId(virtualId, callback);
}

/**
 * This is a hack to be able to bullet proof the
 * `getStripeAccountByOrganizationId` view and locks stripe account creation
 */
export function hasCreatePaymentAccountActionId(organizationId, callback) {
  const virtualId = createVitualCreatePaymentAccountActionId(organizationId);
  this.hasUniqId(virtualId, callback);
}

export function addUniqId(
  id, // can be a list
  callback
) {
  const key = `${getDbName(this.config)}:uid`;

  const ids = arrayify(id).filter(Boolean);
  if (!ids.length) {
    return callback(null);
  }

  this.redis.sadd(key, ...ids, (err, res) => {
    if (err) {
      return callback(createError(500, err));
    }

    callback(null);
  });
}

export function removeUniqId(
  id, // can be a list
  callback
) {
  const key = `${getDbName(this.config)}:uid`;

  const ids = arrayify(id).filter(Boolean);
  if (!ids.length) {
    return callback(null);
  }

  this.redis.srem(key, ...ids, (err, res) => {
    if (err) {
      return callback(createError(500, err));
    }

    callback(null);
  });
}

/**
 * this is called by librarian#put to keep the Redis Set up to date
 */
export function syncUniqIds(docs, callback) {
  const addedIds = new Set();
  const removedIds = new Set();

  arrayify(docs).forEach(doc => {
    const id = getId(doc);
    if (
      id &&
      (id.startsWith('org:') ||
        id.startsWith('journal:') ||
        id.startsWith('graph:') ||
        id.startsWith('issue:') ||
        id.startsWith('user:') ||
        (id.startsWith('action:') && doc['@type'] === 'RequestArticleAction'))
    ) {
      if (doc._deleted) {
        removedIds.add(id);
        if (id.startsWith('org:')) {
          removedIds.add(createVitualActiveSubscribeActionId(id));
          removedIds.add(createVitualCreateCustomerAccountActionId(id));
          removedIds.add(createVitualCreatePaymentAccountActionId(id));
        }
      } else {
        addedIds.add(id);
      }
    }

    // Special case for SubscribeAction
    // we track the active SubscribeAction to bullet proof the SubscribeAction handler lock
    if (id && id.startsWith('action:') && doc['@type'] === 'SubscribeAction') {
      const organizationId = getScopeId(doc);
      const virtualId = createVitualActiveSubscribeActionId(organizationId);
      if (doc._deleted) {
        removedIds.add(virtualId);
      } else {
        if (doc.actionStatus === 'ActiveActionStatus') {
          addedIds.add(virtualId);
        } else {
          removedIds.add(virtualId);
        }
      }
    }

    // Special case for CreateCustomerAccountAction
    if (
      id &&
      id.startsWith('action:') &&
      doc['@type'] === 'CreateCustomerAccountAction'
    ) {
      const organizationId = getScopeId(doc);
      const virtualId = createVitualCreateCustomerAccountActionId(
        organizationId
      );
      if (doc._deleted) {
        removedIds.add(virtualId);
      } else {
        addedIds.add(virtualId);
      }
    }

    // Special case for CreatePaymentAccountAction
    if (
      id &&
      id.startsWith('action:') &&
      doc['@type'] === 'CreatePaymentAccountAction'
    ) {
      const organizationId = getScopeId(doc);
      const virtualId = createVitualCreatePaymentAccountActionId(
        organizationId
      );
      if (doc._deleted) {
        removedIds.add(virtualId);
      } else {
        addedIds.add(virtualId);
      }
    }

    if (id && id.startsWith('graph:') && doc['@type'] === 'Graph' && doc.slug) {
      if (doc._deleted) {
        removedIds.add(doc.slug);
      } else {
        addedIds.add(doc.slug);
      }
    }

    if (
      id &&
      id.startsWith('user:') &&
      doc['@type'] === 'Person' &&
      doc.contactPoint
    ) {
      arrayify(doc.contactPoint).forEach(cp => {
        if (
          cp.contactType === CONTACT_POINT_ADMINISTRATION &&
          cp.email &&
          cp.email.startsWith('mailto:')
        ) {
          if (doc._deleted) {
            removedIds.add(cp.email);
          } else {
            addedIds.add(cp.email);
          }
        }
      });
    }
  });

  this.removeUniqId(Array.from(removedIds), errRemove => {
    this.addUniqId(Array.from(addedIds), errAdd => {
      const messages = [];
      if (errRemove) {
        messages.push(`Could not remove ${Array.from(removedIds).join(', ')}`);
      }
      if (errAdd) {
        messages.push(`Could not add ${Array.from(addedIds).join(', ')}`);
      }
      if (messages.length) {
        return callback(createError(500, messages.join(' ; ')));
      }

      callback(null, {
        addedIds: Array.from(addedIds),
        removedIds: Array.from(removedIds)
      });
    });
  });
}

function createVitualActiveSubscribeActionId(organizationId) {
  return `active-subscribe-action:${getId(organizationId)}`;
}

function createVitualCreateCustomerAccountActionId(organizationId) {
  return `create-customer-account-action:${getId(organizationId)}`;
}

function createVitualCreatePaymentAccountActionId(organizationId) {
  return `create-payment-account-action:${getId(organizationId)}`;
}
