import traverse from 'traverse';
import isPlainObject from 'lodash/isPlainObject';
import pick from 'lodash/pick';
import { getNodeMap, getId, arrayify, dearrayify } from '@scipe/jsonld';
import createId from '../create-id';
import setId from './set-id';
import { getParts } from './schema-utils';
import schema from './schema';

/**
 * Partially embed `release` into `issue.hasPart`
 */
export function getEmbeddedIssuePart(release) {
  const nodeMap = getNodeMap(release);
  const mainEntity = nodeMap[getId(release.mainEntity)];

  return Object.assign(
    {
      '@id': `${createId('graph', release)['@id']}?version=latest`
    },
    pick(release, ['@type', 'datePublished']),
    mainEntity ? { mainEntity: pick(mainEntity, ['@type', 'name']) } : undefined
  );
}

/**
 * Note: for now embedded Nodes are at the top level of `doc` (assets or
 * @graph nodes)
 */
export function getEmbeddedNodeAndProp(nodeId, doc = {}) {
  const props = Object.keys(doc);
  for (const p of props) {
    if (p === 'mainEntity') {
      continue;
    }
    const node = arrayify(doc[p]).find(
      r => getId(r) === nodeId && isPlainObject(r)
    );

    if (node) {
      return [node, p];
    }
  }
  return [];
}

/**
 * This needs to be called before validation
 * Set:
 * - `@id`, `isNodeOf` and `encodesCreativeWork` of resource & encodings
 * - TODO? `@id`, `isNodeOf` of `comment` & `annotation`
 */
export function setEmbeddedIds(
  doc // graph, issue, journal, org, service, profile,
) {
  const overwrite = {};
  const relabelMap = {};

  ['style', 'logo', 'image', 'audio', 'video'].forEach(p => {
    if (doc[p]) {
      overwrite[p] = dearrayify(
        doc[p],
        arrayify(doc[p]).map(resource => {
          if (isPlainObject(resource)) {
            const resourceId = createId('node', resource);
            const overwrite = {};

            if (resource.encoding) {
              overwrite.encoding = dearrayify(
                resource.encoding,
                arrayify(resource.encoding).map(encoding => {
                  if (isPlainObject(encoding)) {
                    const overwrite = {};
                    if (encoding.thumbnail) {
                      overwrite.thumbnail = dearrayify(
                        encoding.encoding,
                        arrayify(encoding.thumbnail).map(thumbnail => {
                          if (isPlainObject(thumbnail)) {
                            return setId(
                              Object.assign({}, thumbnail, {
                                isNodeOf: getId(doc),
                                encodesCreativeWork: getId(resourceId)
                              }),
                              createId('node', thumbnail),
                              relabelMap
                            );
                          }
                          return thumbnail;
                        })
                      );
                    }

                    return setId(
                      Object.assign(
                        {},
                        encoding,
                        {
                          isNodeOf: getId(doc),
                          encodesCreativeWork: getId(resourceId)
                        },
                        overwrite
                      ),
                      createId('node', encoding),
                      relabelMap
                    );
                  }
                  return encoding;
                })
              );
            }

            return setId(
              Object.assign({}, resource, { isNodeOf: getId(doc) }, overwrite),
              resourceId,
              relabelMap
            );
          }

          return resource;
        })
      );
    }
  });

  ['comment', 'annotation', 'resultReview', 'resultComment'].forEach(p => {
    if (doc[p]) {
      overwrite[p] = dearrayify(
        doc[p],
        arrayify(doc[p]).map(node => {
          if (isPlainObject(node)) {
            return setId(
              Object.assign({}, node, { isNodeOf: getId(doc) }, overwrite),
              createId('node', node),
              relabelMap
            );
          }
        })
      );
    }
  });

  // Flat data model
  if (doc['@graph']) {
    const nodeMap = getNodeMap(doc);
    let partMap = {};
    let encodingMap = {}; // also includes thumbnails
    if (getId(doc.mainEntity)) {
      const parts = [nodeMap[getId(doc.mainEntity)]]
        .concat(getParts(getId(doc.mainEntity), nodeMap))
        .filter(Boolean);

      partMap = getNodeMap(parts);

      encodingMap = parts.reduce((map, part) => {
        arrayify(part.encoding)
          .concat(arrayify(part.distribution))
          .forEach(encodingId => {
            const encoding = nodeMap[getId(encodingId)];
            if (encoding) {
              map[getId(encoding)] = encoding;

              arrayify(encoding.thumbnail).forEach(thumbnailId => {
                const thumbnail = nodeMap[getId(thumbnailId)];
                if (thumbnail) {
                  map[getId(thumbnail)] = thumbnail;
                }
              });
            }
          });
        return map;
      }, {});
    }

    Object.keys(partMap)
      .concat(Object.keys(encodingMap))
      .forEach(id => {
        if (id && id.startsWith('_:')) {
          relabelMap[id] = createId('node', null)['@id'];
        }
      });

    let hasUpdatedNodes = false;
    const nodes = arrayify(doc['@graph']).map(node => {
      const overwrite = {};
      const nodeId = getId(node);
      // Add the `isNodeOf` prop
      // Note: `isNodeOf` is only set for Graph for the parts and their encodings
      // (for the rest we cannot know if the node @id was created by us or not)
      if (
        !getId(node.isNodeOf) &&
        nodeId &&
        (nodeId in partMap || nodeId in encodingMap) &&
        (nodeId.startsWith('_:') || nodeId.startsWith('node:'))
      ) {
        overwrite.isNodeOf = getId(doc);
        hasUpdatedNodes = true;
      }

      // Ensure that all the encodings have a well defined `encodesCreativeWork`
      // property
      if (
        !getId(node.encodesCreativeWork) &&
        (schema.is(node['@type'], 'MediaObject') ||
          node.contentUrl ||
          node.contentSize != null)
      ) {
        const creativeWork = arrayify(doc['@graph']).find(_node => {
          const encodings = arrayify(_node.encoding).concat(
            arrayify(_node.distribution)
          );
          return encodings.some(encodingId => encodingId === getId(node));
        });
        if (getId(creativeWork)) {
          hasUpdatedNodes = true;
          overwrite.encodesCreativeWork = getId(creativeWork);
        }
      }

      return Object.keys(overwrite).length
        ? Object.assign({}, node, overwrite)
        : node;
    });

    if (hasUpdatedNodes) {
      overwrite['@graph'] = nodes;
    }
  }

  if (Object.keys(overwrite).length) {
    let nextDoc = Object.assign({}, doc, overwrite);
    if (Object.keys(relabelMap).length) {
      nextDoc = traverse.map(nextDoc, function(x) {
        if (typeof x === 'string' && x.startsWith('_:') && x in relabelMap) {
          this.update(relabelMap[x]);
        }
      });
    }
    return nextDoc;
  }

  return doc;
}
