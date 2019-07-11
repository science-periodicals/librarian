import schema from './schema';
import { getId, arrayify, getNodeMap } from '@scipe/jsonld';

export default function getResourceBlacklist(nodes) {
  nodes = arrayify(nodes);
  const nodeMap = getNodeMap(nodes);

  const blacklist = new Set();
  nodes.forEach(node => {
    const nodeId = getId(node);
    if (
      schema.is(node, 'WPAbstract') ||
      schema.is(node, 'WPImpactStatement') ||
      schema.is(node, 'WPDisclosure') ||
      schema.is(node, 'WPAcknowledgements') ||
      schema.is(node, 'MediaObject') ||
      schema.is(node, 'CreativeWorkSeries') ||
      schema.is(node, 'Periodical') ||
      schema.is(node, 'PublicationIssue') ||
      schema.is(node, 'PublicationVolume') ||
      schema.is(node, 'Comment') ||
      schema.is(node, 'Review') ||
      schema.is(node, 'Conversation')
    ) {
      blacklist.add(nodeId);
    }

    // we add encoding and distribution here in case the @type was not
    // set and so the node not blacklisted with the if statement from
    // above
    [
      'citation',
      'exampleOfWork',
      'license',
      'encoding',
      'distribution'
    ].forEach(p => {
      if (node[p]) {
        arrayify(node[p]).forEach(ref => {
          const refId = getId(ref);
          if (refId) {
            blacklist.add(refId);
          }
          let _root = nodeMap[refId];
          while (_root && _root.isPartOf) {
            const parentId = getId(_root.isPartOf);
            if (parentId) {
              blacklist.add(parentId);
            }
            _root = nodeMap[parentId];
          }
        });
      }
    });
  });

  return blacklist;
}
