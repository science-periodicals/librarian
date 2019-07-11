import isClient from 'is-client';
import { unprefix } from '@scipe/jsonld';
import getScopeId from './get-scope-id';
import { getRootPartId } from '../utils/schema-utils';

export default function getPurl(graph = {}) {
  const origin =
    process.env.NODE_ENV === 'production'
      ? 'https://purl.org'
      : isClient()
      ? window.location.origin
      : 'https://purl.org';

  const pathname = `/${
    process.env.NODE_ENV === 'production' || !isClient() ? 'sa/' : ''
  }${graph.slug || unprefix(getScopeId(graph))}`;

  let search =
    process.env.NODE_ENV === 'production'
      ? ''
      : `?hostname=${unprefix(getRootPartId(graph))}.sci.pe`;

  return origin + pathname + search;
}
