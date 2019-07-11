import { getId, unprefix } from '@scipe/jsonld';
import { parseIndexableString } from '@scipe/collate';
import createId from '../create-id';

export default function getScopeId(
  node, // can be a string (@id)
  { preserveVersion = false } = {}
) {
  if (!node) return node;

  const nodeId = getId(node);

  if (
    node._id &&
    !(typeof nodeId === 'string' && nodeId.startsWith('graph:')) // in this case we may want to preserve the version (see below)
  ) {
    const [maybeScope, type] = parseIndexableString(node._id);
    if (type === 'profile') {
      return createId('user', maybeScope)['@id'];
    }

    return maybeScope;
  }

  if (typeof nodeId === 'string') {
    // be sure to remove the version part from graphId in case of releases
    if (nodeId.startsWith('graph:')) {
      return preserveVersion ? nodeId : nodeId.split('?version')[0];
    }

    // scope of issue is the associated journal
    if (nodeId.startsWith('issue:')) {
      const scopeId = getScopeId(node.isPartOf, { preserveVersion });
      if (scopeId) {
        return scopeId;
      }
      return `journal:${unprefix(nodeId).split('/')[0]}`;
    }

    if (
      nodeId.startsWith('_:') ||
      nodeId.startsWith('node:') ||
      nodeId.startsWith('role:') ||
      nodeId.startsWith('contact:')
    ) {
      const embedder = node.isNodeOf;

      const scopeId = getScopeId(embedder, { preserveVersion });
      if (scopeId) return scopeId;
    }
  }

  if (node.encodesCreativeWork) {
    const scopeId = getScopeId(node.encodesCreativeWork, { preserveVersion });
    if (scopeId) return scopeId;
  }

  return nodeId;
}
