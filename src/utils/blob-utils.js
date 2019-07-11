import { arrayify, getId, unprefix } from '@scipe/jsonld';
import getScopeId from './get-scope-id';

/**
 * This is required for the ACL of the GET /encoding route
 */
export function versionNodes(graph) {
  if (!graph || !graph['@graph'] || !graph.version) {
    return graph;
  }

  const version = graph.version;

  return Object.assign({}, graph, {
    '@graph': arrayify(graph['@graph']).map(node => {
      const nodeId = getId(node);

      const overwrite = {};
      if (
        node.contentUrl &&
        node.contentUrl.startsWith('/encoding/') &&
        nodeId &&
        (nodeId.startsWith('_:') || nodeId.startsWith('node:'))
      ) {
        overwrite.contentUrl = `${
          node.contentUrl.split('?')[0]
        }?graph=${unprefix(getScopeId(graph))}&version=${version}`;
      }

      if (node.isNodeOf && getScopeId(node.isNodeOf) === getScopeId(graph)) {
        overwrite.isNodeOf = getId(graph);
      }

      if (
        node.resourceOf &&
        getScopeId(node.resourceOf) === getScopeId(graph)
      ) {
        overwrite.resourceOf = getId(graph);
      }

      if (Object.keys(overwrite).length) {
        return Object.assign({}, node, overwrite);
      }

      return node;
    })
  });
}
