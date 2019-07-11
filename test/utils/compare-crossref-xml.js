import { DOMParser, XMLSerializer } from 'xmldom';

export function comparableCrossrefXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  //remove 'doi_batch_id' and 'timestamp' as they can vary between runs. Both are child nodes of <head>

  const headNode = doc.getElementsByTagName('head')[0];
  //remove doi batch id node
  headNode.removeChild('doi_batch_id');

  //remove timestamp node
  headNode.removeChild('timestamp');

  const cleanXml = new XMLSerializer().serializeToString(doc);
  return cleanXml;
}
