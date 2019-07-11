import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { DOMParser, XMLSerializer } from 'xmldom';

import { flatten, getNodeMap, getId } from '@scipe/jsonld';
import { Librarian, Store } from '../src';
import registerDois, { getCrossrefXml } from '../src/methods/register-dois';
import { comparableCrossrefXml } from './utils/compare-crossref-xml';
import { getParts } from '../src/utils/schema-utils';

describe('registerDois', function() {
  this.timeout(40000);

  let flattenedGraph, periodical, graphWithDois, librarian, store;
  before(async () => {
    periodical = {
      '@id': 'journal:journalId',
      '@type': 'Peridiodical',
      name: 'journal of science'
    };

    librarian = new Librarian();
    store = new Store(periodical);

    const _graph = JSON.parse(
      fs.readFileSync(path.join(__dirname, './fixtures/graph.json'))
    );

    const graphId = 'graph:graphId';

    const graph = {
      '@id': graphId,
      '@type': 'Graph',
      mainEntity: 'node:article',
      slug: 'graphId',
      datePublished: new Date().toISOString(),
      isPartOf: 'journal:journalId',
      '@graph': _graph
    };

    flattenedGraph = await flatten(graph);

    graphWithDois = await librarian.registerDois(flattenedGraph, {
      store
    });
  });

  it('should generate valid XML to deposit to crossref', () => {
    //must be a string
    const crossrefXml = fs.readFileSync(
      path.join(__dirname, './fixtures/crossref.xml'),
      {
        encoding: 'utf8'
      }
    );

    const crossrefXmlDom = new DOMParser().parseFromString(
      crossrefXml,
      'text/xml'
    );
    const expectedXml = new XMLSerializer().serializeToString(crossrefXmlDom);

    const resultXml = getCrossrefXml(graphWithDois, periodical);

    assert.equal(
      comparableCrossrefXml(expectedXml)
        .replace(/(\r\n|\n|\r)/gm, '') //remove returns
        .replace(/\s+/g, ' ') //remove spaces
        .replace(/>[\t ]+</g, '><'), //remove whitespace between tags
      comparableCrossrefXml(resultXml)
        .replace(/(\r\n|\n|\r)/gm, '')
        .replace(/\s+/g, ' ')
        .replace(/>[\t ]+</g, '><')
    );
  });

  it('should add dois to the graph and all parts', async () => {
    //graph doi
    assert(graphWithDois.doi);

    //part dois
    const nodeMap = getNodeMap(graphWithDois);
    const mainEntity =
      graphWithDois.mainEntity && nodeMap[getId(graphWithDois.mainEntity)];

    const parts = getParts(mainEntity, nodeMap);

    assert(parts.every(part => !!part.doi));
  });
});
