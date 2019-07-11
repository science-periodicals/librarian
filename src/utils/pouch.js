import isPlainObject from 'lodash/isPlainObject';
import { getId, getValue, arrayify } from '@scipe/jsonld';

/**
 * Augment `master` with non conflicting props from the conflicting
 * leaves
 */
export function merge(master, conflicting) {
  if (!conflicting || !conflicting.length) {
    return {
      merged: master,
      deleted: []
    };
  }

  conflicting = conflicting.slice().sort((a, b) => {
    let [seqA, revA] = a._rev.split('-');
    let [seqB, revB] = b._rev.split('-');
    if (seqA === seqB) {
      return revB.localeCompare(revA);
    } else {
      return parseInt(seqB, 10) - parseInt(seqA, 10);
    }
  });

  let hasChanged = false;
  let autoMerge = true;
  let merged = conflicting.reduce((merged, rev) => {
    Object.keys(rev).forEach(key => {
      if (key !== '_rev' && key !== '_id') {
        if (
          !(key in merged) ||
          (getValue(rev[key]) !== '' && getValue(merged[key]) === '')
        ) {
          merged[key] = rev[key];
          hasChanged = true;
        } else if (Array.isArray(rev[key]) || Array.isArray(merged[key])) {
          let value = Array.isArray(merged[key]) ? merged[key] : [merged[key]];
          let _value = Array.isArray(rev[key]) ? rev[key] : [rev[key]];

          let toAdd = _value.filter(
            el => !value.some(_el => getValue(el) === getValue(_el))
          );
          if (toAdd.length) {
            merged[key] = value.concat(toAdd);
            hasChanged = true;
          }
        } else {
          if (getValue(merged[key]) !== getValue(rev[key])) {
            autoMerge = false;
          }
        }
      }
    });
    return merged;
  }, Object.assign({}, master));

  let deleted = (autoMerge
    ? conflicting
    : conflicting.filter(rev => {
        // when we can't autoMerge, we may be able to delete some of the revs with no relevant information
        // we delete any rev that do not conflict with the merged document
        const hasConflict = Object.keys(rev).some(p => {
          if (p === '_rev' || p === '_id') {
            return false;
          }
          if (
            Array.isArray(merged[p]) ||
            Array.isArray(rev[p]) ||
            getValue(rev[p]) === ''
          ) {
            return false; // props whose values are arrays or '' never conflict
          } else {
            return getValue(rev[p]) !== getValue(merged[p]);
          }
        });
        return !hasConflict;
      })
  ).map(rev => Object.assign({ _deleted: true }, rev));

  return {
    merged: hasChanged ? merged : master,
    deleted: deleted
  };
}

/**
 * @param node - the node to update
 * @param upd - the update payload: Note: null or [] are used to delete properties
 * @returns an updated node
 */
export function updateNode(
  node,
  upd,
  {
    replace = false, // Fully replace `node` by `upd`: if `node` has keys not present in `upd` and `replace` is set to true, those keys will be deleted. For the common keys, the other option still apply
    replaceArray = false, // Fully replace arrays
    mergeProps = [], // Escape hatch for `replace` and `replaceArray`: a list of props that will be merged (appended to array for instance) instead of replaced
    preserveOrder = false // when arrays are merged and `preserveOrder` is set to true, the order of `upd` list is preserved (so that re-ordering ops can be done)
  } = {}
) {
  mergeProps = arrayify(mergeProps).filter(Boolean);

  const nextNode = Object.keys(node)
    .concat(Object.keys(upd).filter(key => !(key in node)))
    .reduce((updatedNode, key) => {
      if (key in upd) {
        // Note: what follows contains some weird workaround due to an issue with jsonld flatten
        // where an empty list triggers the key to be expanded e.g., { "schema:hasPart": {
        // "@list": [] } } instead of { "hasPart": { "@list": [] } } see
        // https://github.com/digitalbazaar/jsonld.js/issues/140 for details.
        if (
          Array.isArray(node[key]) ||
          ((key.startsWith('schema:') || key.startsWith('sa:')) &&
            Array.isArray(node[key.replace(/^.*:/, '')])) // workaround (see comment above)
        ) {
          if (replaceArray && !mergeProps.includes(key)) {
            if (
              upd[key] === null ||
              !upd[key].length ||
              (upd[key] && upd[key]['@list'] && !upd[key]['@list'].length) // last part is workaround (see comment above)
            ) {
              delete updatedNode[key];
            } else {
              updatedNode[key] = upd[key];
            }
          } else if (preserveOrder) {
            // we preserve the order of the update list (so that re-ordering operation can be done)
            updatedNode[key] = arrayify(upd[key]).concat(
              node[key].filter(ref => {
                return !arrayify(upd[key]).some(
                  _ref => getValue(_ref) === getValue(ref)
                );
              })
            );
          } else {
            updatedNode[key] = node[key].concat(
              arrayify(upd[key]).filter(ref => {
                return !node[key].some(
                  _ref => getValue(_ref) === getValue(ref)
                );
              })
            );
          }
        } else {
          updatedNode[key] = upd[key];
        }
      } else {
        // `key` is not in `upd`
        if (
          (!replace && !(`schema:${key}` in upd || `sa:${key}` in upd)) || // was already handled (see workaround due to the JSON-LD weirdness explained above)
          mergeProps.includes(key)
        ) {
          updatedNode[key] = node[key];
        }
      }
      return updatedNode;
    }, {});

  // delete null or []
  Object.keys(nextNode).forEach(key => {
    const value = nextNode[key];
    if (value == null || (Array.isArray(value) && !value.length)) {
      delete nextNode[key];
    }
  });

  return nextNode;
}

export function deleteRef(node, ref, opts = {}) {
  if (!node || ref === undefined) return node;

  let {
    props // restrict deletion to the specified props
  } = opts;
  props = props && arrayify(props);

  const refs = arrayify(ref);

  let hasChanged = false;

  let updatedNode = Object.keys(node).reduce((updatedNode, key) => {
    const value = node[key];
    if (props && !props.includes(key)) {
      // skip deletion...
      updatedNode[key] = value;
    } else {
      if (Array.isArray(value)) {
        updatedNode[key] = value.filter(x => !~refs.indexOf(x['@id'] || x));
        if (updatedNode[key].length < value.length) {
          hasChanged = true;
        }
        if (!updatedNode[key].length) {
          delete updatedNode[key];
        }
      } else if (~refs.indexOf(getId(value))) {
        hasChanged = true;
        // key is not set in updatedNodde
      } else {
        updatedNode[key] = value;
      }
    }
    return updatedNode;
  }, {});

  return hasChanged ? updatedNode : node;
}

export function isEqualByProperty(property, updateNode, node) {
  if (!(property in updateNode) || !(property in node)) return false;

  const values = arrayify(updateNode[property]);
  const _values = arrayify(node[property]);

  return values.some(v => {
    return _values.some(_v => {
      return getValue(v) === getValue(_v);
    });
  });
}

export function isEqualByContentChecksum(
  updateNode,
  node,
  updateNodeMap,
  nodeMap
) {
  // match by checksum
  if (!updateNode.contentChecksum || !node.contentChecksum) {
    return false;
  }

  return updateNode.contentChecksum.some(checksumId => {
    return node.contentChecksum.some(_checksumId => {
      const checksum = updateNodeMap[checksumId];
      const _checksum = nodeMap[_checksumId];
      if (
        !checksum ||
        !checksum.checksumValue ||
        !_checksum ||
        !_checksum.checksumValue
      )
        return false;

      return (
        getValue(checksum.checksumValue) === getValue(_checksum.checksumValue)
      );
    });
  });
}

export function isEqualByEncoding(updateNode, node, updateNodeMap, nodeMap) {
  if (
    !(
      (updateNode.encoding && node.encoding) ||
      (updateNode.distribution && node.distribution)
    )
  ) {
    if (
      updateNode.hasPart &&
      node.hasPart &&
      updateNode.hasPart.length > 0 &&
      updateNode.hasPart.length === node.hasPart.length
    ) {
      // may be multi part figure
      return arrayify(updateNode.hasPart).every(partId => {
        return arrayify(node.hasPart).some(_partId => {
          const part = updateNodeMap[partId];
          const _part = nodeMap[_partId];
          if (!part || !_part) return false;
          return isEqualByEncoding(part, _part, updateNodeMap, nodeMap);
        });
      });
    }
    return false;
  }

  const encodingIds = updateNode.encoding || updateNode.distribution;
  const _encodingIds = node.encoding || node.distribution;

  return encodingIds.some(encodingId => {
    return _encodingIds.some(_encodingId => {
      if (encodingId === _encodingId) return true;

      const encoding = updateNodeMap[encodingId];
      const _encoding = nodeMap[_encodingId];
      if (!encoding || !_encoding) return false;

      return (
        isEqualByProperty('@id', encoding, _encoding) ||
        isEqualByProperty('sameAs', encoding, _encoding) ||
        //isEqualByProperty('url', encoding, _encoding) || too dangerous as DW set those to arbitrary things
        isEqualByProperty('contentUrl', encoding, _encoding) ||
        isEqualByContentChecksum(encoding, _encoding, updateNodeMap, nodeMap)
      );
    });
  });
}

/**
 * Helper to execute an UpdateAction with an `OverwriteMergeStrategy`
 */
export function handleOverwriteUpdate(
  object, // the object to be updated (Role, CssVariable, Periodical etc.)
  upd, // update payload (already validated in the context of `object` and `selector` see `validateOverwriteUpdate` in validators.js)
  selector // may be undefined
) {
  // Update a given property (and possibly a value within that prop if that prop is a list)
  if (selector && selector.selectedProperty) {
    const prop = selector.selectedProperty;

    const valueId = getId(selector.node);
    if (!(prop in object) || !valueId) {
      return Object.assign({}, object, {
        [prop]:
          object[prop] && isPlainObject(object[prop])
            ? updateNode(object[prop], upd, {
                replaceArray: true
              })
            : upd
      });
    }

    if (valueId) {
      if (arrayify(object[prop]).some(value => getId(value) === valueId)) {
        return Object.assign({}, object, {
          [prop]: arrayify(object[prop]).map(value => {
            if (getId(value) === valueId) {
              return isPlainObject(value)
                ? updateNode(value, upd, {
                    replaceArray: true
                  })
                : upd;
            }
            return value;
          })
        });
      }

      // add it
      return Object.assign({}, object, {
        [prop]: arrayify(object[prop]).concat(upd)
      });
    }
  }

  // Update the root `object`
  return updateNode(object, upd, {
    replaceArray: true
  });
}
