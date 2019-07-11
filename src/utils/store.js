import uniqBy from 'lodash/uniqBy';
import { getId, arrayify } from '@scipe/jsonld';
import { parseIndexableString } from '@scipe/collate';
import schema from './schema';
import getScopeId from './get-scope-id';
import { getVersion } from './workflow-utils';
import { getObjectId } from '../utils/schema-utils';
import { hasOutdatedStateMachineStatus } from '../methods/workflow-action-data';

/**
 * Used to cache documents fetched from CouchDB
 * either through librarian.get or put, (this._data)
 * or through the views (this._cache)
 */
export default class Store {
  constructor(docs) {
    this._data = {};
    this._cache = {}; // for the views
    this.add(docs);
  }

  cache(key, payload, { includeDocs = false } = {}) {
    this._cache[key] = payload;
    if (includeDocs) {
      this.add(payload);
    }
  }

  /**
   * note if we only have an _id need to be called with { _id: id } (only way to differentiate from @id)
   */
  get(docOrKey) {
    if (!docOrKey) return;

    // _id first
    const _id = docOrKey._id;
    if (_id && _id in this._data) {
      return this._data[_id];
    }

    const id = getId(docOrKey);
    if (id) {
      if (id in this._data) {
        return this._data[id];
      }

      if (id in this._cache) {
        return this._cache[id];
      }

      // try for graph id with ?version=
      if (id.startsWith('graph:')) {
        const version = getVersion(id);
        if (version) {
          const scopeId = getScopeId(id);
          const doc = Object.keys(this._data)
            .map(key => this._data[key])
            .find(doc => {
              return (
                getScopeId(doc) === scopeId &&
                doc['@type'] === 'Graph' &&
                (doc.version === version ||
                  (version === 'latest' &&
                    doc._id &&
                    parseIndexableString(doc._id)[2] === 'latest'))
              );
            });
          if (doc) {
            return doc;
          }
        }
      }
    }
  }

  getAll() {
    // `this._data` contains entry by @id and _id so we need to dedup
    return uniqBy(Object.keys(this._data).map(key => this.get(key)), x => {
      return getId(x) || x._id;
    });
  }

  getPotentialActions(objectId, { all = false } = {}) {
    objectId = all ? getScopeId(getId(objectId)) : getId(objectId);

    // `this._data` contains entry by @id and _id so we need to dedup

    return uniqBy(
      Object.keys(this._data)
        .map(id => this._data[id])
        .filter(node => {
          if (schema.is(node, 'Action')) {
            return all
              ? getScopeId(getObjectId(node)) === objectId
              : getObjectId(node) === objectId;
          }
          return false;
        }),
      x => {
        return getId(x) || x._id;
      }
    );
  }

  /**
   * Note: `add` is safe for workflow action as it will only add `docs` if they
   * are more recent (wrt to actionStatus) that the ones in the store
   */
  add(docs) {
    if (docs == null) {
      return;
    }

    arrayify(docs).forEach(doc => {
      const existing = this.get(doc);
      if (existing && doc._id) {
        // for workflow action we only replace if the actionStatus is equal (or
        // more advanced) than the one present in the store
        const [scopeId, type] = parseIndexableString(doc._id);
        if (
          type === 'action' &&
          scopeId &&
          scopeId.startsWith('graph:') &&
          existing.actionStatus
        ) {
          const isOutdated = hasOutdatedStateMachineStatus(
            doc,
            existing.actionStatus
          );
          if (isOutdated) {
            return;
          }
        }
      }

      const _id = doc._id;
      if (_id) {
        this._data[_id] = doc;
      }

      const id = getId(doc);
      if (id) {
        this._data[id] = doc;
      }
    });
  }

  reset() {
    this._data = {};
    this._cache = {};
  }

  // This method only hydrate if `doc` is a string or and object with only `@id` and/or `_id` (but nothing else) otherwise it does nothing assuming that the caller has more up-to-date (or mutated) data
  // Note: `doc` can be a simple string (handled by `getId`)
  hydrate(doc) {
    if (
      doc &&
      (typeof doc === 'string' ||
        Object.keys(doc).every(key => key === '@id' || key === '_id'))
    ) {
      return this.get(doc) || doc;
    }
    return doc;
  }

  has(docs) {
    return arrayify(docs).every(doc => {
      return !!this.get(doc);
    });
  }
}
