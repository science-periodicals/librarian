import createError from '@scipe/create-error';
import isPlainObject from 'lodash/isPlainObject';
import { getId, flatten, arrayify } from '@scipe/jsonld';

/**
 * return a nodeMap allowing to hydrate the @id of `object`
 */
export default async function hydrate(object, { acl, store } = {}) {
  if (!isPlainObject(object)) {
    throw createError(400, 'invalid object');
  }

  // flatten
  try {
    var flattened = await flatten(object, { preserveUuidBlankNodes: true });
  } catch (err) {
    this.log.debug(
      { err, object, flattened },
      'librarian.hydrate could not flatten'
    );
    throw err;
  }

  // get @id to fetch
  const nodes = flattened['@graph'];
  const blackset = new Set(nodes.map(node => getId(node)).filter(Boolean));

  const hydratedNodeMap = {};
  const ids = new Set();
  nodes.forEach(node => {
    gatherIds(ids, blackset, node);
  });

  while (ids.size > 0) {
    let docs;
    try {
      docs = await this.get(Array.from(ids), {
        store,
        acl
      });
    } catch (err) {
      // we ignore 401 and 403 as user might not have access to some of the droplets, but that's fine as librarian.get will have filtered out the forbidden docs
      if (
        err &&
        !err.code === 404 &&
        !((err.code === 401 || err.code === 403) && droplets)
      ) {
        throw err;
      }
      if (!docs) {
        docs = err.body || [];
      }
    }

    ids.clear();
    const nodeMap = {};
    docs.forEach(doc => {
      arrayify(doc['@graph']).forEach(node => {
        if (node['@id']) {
          blackset.add(node['@id']);
          nodeMap[node['@id']] = node;
        }
      });
      if (doc['@id']) {
        blackset.add(doc['@id']);
        nodeMap[doc['@id']] = doc;
      }
    });

    docs.forEach(doc => {
      gatherIds(ids, blackset, doc);
    });

    Object.assign(hydratedNodeMap, nodeMap);
  }

  const droplets = Object.keys(hydratedNodeMap).map(
    key => hydratedNodeMap[key]
  );

  return hydratedNodeMap;
}

function gatherIds(ids, blackset, node) {
  if (isPlainObject(node)) {
    Object.keys(node).forEach(prop => {
      const values = arrayify(node[prop]);
      values.forEach(value => {
        if (
          typeof value === 'string' &&
          /^scipe:|^service:|^workflow:|^journal:|^type:|^graph:|^action:|^issue:|^node:|^cnode:|^role:|^event:|^user:|^org:/i.test(
            value
          ) &&
          !blackset.has(value)
        ) {
          ids.add(value);
          blackset.add(value);
        } else {
          gatherIds(ids, blackset, value);
        }
      });
    });
  }
}
