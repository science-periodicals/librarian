import { DOMParser, XMLSerializer } from 'xmldom';
import slug from 'slug';
import request from 'request';
import path from 'path';
import {
  unprefix,
  getId,
  arrayify,
  getAgentId,
  getNodeMap,
  textify
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { SA_DOI_PREFIX, SCIPE_URL } from '../constants';
import { getParts, getRootPartId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';

/**
 * Returns a new `graph` with DOIs after having registered them with crossref
 *
 * Note, crossref requires that metadata be deposited as an xml file
 * - for testing use: https://test.crossref.org/servlet
 * - for prod use: https://doi.crossref.org/servlet
 */
export default async function registerDois(
  graph,
  {
    store,
    skipDoiRegistration = false // mostly used for testing purpose to shortcut the crossref calls
  } = {}
) {
  skipDoiRegistration = skipDoiRegistration || this.config.skipDoiRegistration;

  if (skipDoiRegistration) {
    // no op
    return graph;
  }

  // We add doi to the Graph `mainEntity` and parts (resources)
  // Note: we cannot use # in doi suffix. The approved character set for DOI
  // suffixes is: “a-z”, “A-Z”, “0-9” and “-._;()/“ => we use `/` for the parts
  const nodeMap = getNodeMap(graph);
  const mainEntity = graph.mainEntity && nodeMap[getId(graph.mainEntity)];

  // only register doi if we have a `datePublished` and a `mainEntity`
  // reason is that crossref use the `datePublished` as "version" for the DOI
  if (!mainEntity || !graph.datePublished) {
    return graph;
  }

  const partIds = new Set(
    getParts(mainEntity, nodeMap)
      .map(getId)
      .filter(Boolean)
  );

  const rootDoi = `${SA_DOI_PREFIX}/${graph.slug ||
    unprefix(getScopeId(graph))}`;

  const graphWithDois = Object.assign({}, graph, {
    doi: rootDoi,
    '@graph': arrayify(graph['@graph']).map(node => {
      if (getId(node) === getId(mainEntity)) {
        return Object.assign({}, node, {
          doi: rootDoi
        });
      }

      if (partIds.has(getId(node))) {
        return Object.assign({}, node, {
          doi: `${rootDoi}/${
            node.alternateName
              ? slug(node.alternateName, {
                  symbols: false,
                  lower: true
                })
              : unprefix(getId(node))
          }`
        });
      }

      return node;
    })
  });

  // We generate some XML to send to crossref
  const periodical = await this.get(getRootPartId(graph), {
    acl: false,
    store
  });

  await registerCrossrefDois(graphWithDois, periodical, this.config);

  return graphWithDois;
}

export function getCrossrefXml(
  graph, // Note: `graph` must have a `datePublished`, a `doi` and a valid `mainEntity` (we don't validate that here)
  periodical,
  { timestamp = new Date().getTime() } = {}
) {
  //Guide to cross ref schema can be found here: http://data.crossref.org/reports/help/schema_doc/4.4.1/index.html

  const xmlSkeleton = `<?xml version="1.0" encoding="UTF-8"?>
  <doi_batch
    xmlns="http://www.crossref.org/schema/4.4.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    version="4.4.0"
    xsi:schemaLocation="http://www.crossref.org/schema/4.4.0 http://www.crossref.org/schemas/crossref4.4.0.xsd"
   >
    <head></head>
    <body>
      <journal>
        <journal_metadata language="en">
        </journal_metadata>
      </journal>
    </body>
  </doi_batch>`;

  const doc = new DOMParser().parseFromString(xmlSkeleton, 'text/xml');

  const headNode = doc.getElementsByTagName('head')[0];

  //add unique id to crossref upload session (required)
  headNode
    .appendChild(doc.createElement('doi_batch_id'))
    .appendChild(doc.createTextNode(unprefix(getScopeId(graph))));

  headNode
    .appendChild(doc.createElement('timestamp'))
    .appendChild(doc.createTextNode(timestamp));

  //add depositor information
  const depositorNode = doc.createElement('depositor');
  headNode.appendChild(depositorNode);

  depositorNode
    .appendChild(doc.createElement('depositor_name'))
    .appendChild(doc.createTextNode('Tiffany Bogich'));

  depositorNode
    .appendChild(doc.createElement('email_address'))
    .appendChild(doc.createTextNode('tiffany@sci.pe'));

  //add registrant
  headNode
    .appendChild(doc.createElement('registrant'))
    .appendChild(doc.createTextNode('Standard Analytics IO'));

  //add journal title (required)
  const journalMetadataNode = doc.getElementsByTagName('journal_metadata')[0];

  journalMetadataNode
    .appendChild(doc.createElement('full_title'))
    .appendChild(
      doc.createTextNode(
        textify(periodical.name) || unprefix(getId(periodical))
      )
    );

  //TODO add journal issn (currently we do not collect it, but it should be a property of the periodical) The format should be validated wherever we collect it

  const issn =
    periodical.issn &&
    periodical.issn.match(/[0-9]{4}-?[0-9]{3,4}[\dX]/) &&
    periodical.issn.match(/[0-9]{4}-?[0-9]{3,4}[\dX]/)[0];

  if (issn) {
    journalMetadataNode
      .appendChild(doc.createElement('issn'))
      .appendChild(doc.createTextNode(issn));
  }

  //add journal doi data (required if no issn is provided)
  const journalDoiNode = doc.createElement('doi_data');
  journalMetadataNode.appendChild(journalDoiNode);

  journalDoiNode
    .appendChild(doc.createElement('doi'))
    .appendChild(
      doc.createTextNode(
        periodical.doi ||
          (periodical.slug && `${SA_DOI_PREFIX}/${periodical.slug}`) ||
          `${SA_DOI_PREFIX}/${unprefix(getId(periodical))}`
      )
    );

  //periodicals must have a url
  const periodicalUrl =
    periodical.url ||
    (periodical['@id'] &&
      `https://${unprefix(periodical['@id']).toLowerCase()}.${path.basename(
        SCIPE_URL
      )}`);

  journalDoiNode
    .appendChild(doc.createElement('resource'))
    .appendChild(doc.createTextNode(periodicalUrl));

  // add graph metadata (as a child of journal article)
  const graphNode = doc.createElement('journal_article');

  doc.getElementsByTagName('journal')[0].appendChild(graphNode);

  const nodeMap = getNodeMap(graph);
  const mainEntity = nodeMap[getId(graph.mainEntity)];

  graphNode.setAttribute('publication_type', 'full_text');

  // graph title
  if (mainEntity.name) {
    graphNode
      .appendChild(doc.createElement('titles'))
      .appendChild(doc.createElement('title'))
      .appendChild(doc.createTextNode(mainEntity.name));
  }

  // add authors
  const authorProps = [
    '@type',
    'name',
    'givenName',
    'additionalName',
    'familyName'
  ];

  const authors = arrayify(mainEntity.authors)
    .map(authorId => {
      const role = nodeMap[authorId];
      return nodeMap[getAgentId(role)];
    })
    .filter(Boolean)
    .filter(author => {
      return (
        (author['@type'] === 'Person' || author['@type'] === 'Organization') &&
        authorProps.some(p => author[p])
      );
    });

  if (authors.length) {
    const authorsNode = doc.createElement('contributors');
    graphNode.appendChild(authorsNode);

    authors.forEach((author, i) => {
      switch (author['@type']) {
        case 'Person': {
          let personNode = doc.createElement('person_name');

          //add attributes
          i === 0
            ? personNode.setAttribute('sequence', 'first')
            : personNode.setAttribute('sequence', 'additional');
          personNode.setAttribute('contributor_role', 'author');

          //add author name information
          if (author.givenName && author.familyName) {
            personNode
              .appendChild(doc.createElement('given_name'))
              .appendChild(doc.createTextNode(author.givenName));

            personNode
              .appendChild(doc.createElement('surname'))
              .appendChild(doc.createTextNode(author.familyName));
          } else {
            const authorName =
              author.name || author.familyName || author.givenName;
            personNode
              .appendChild(doc.createElement('surname'))
              .appendChild(doc.createTextNode(authorName));
          }

          //append node
          authorsNode.appendChild(personNode);

          break;
        }

        case 'Organization': {
          let orgNode = doc.createElement('organization');

          //add attributes
          i === 0
            ? orgNode.setAttribute('sequence', 'first')
            : orgNode.setAttribute('sequence', 'additional');
          orgNode.setAttribute('contributor_role', 'author');

          //append node with text
          authorsNode
            .appendChild(orgNode)
            .appendChild(doc.createTextNode(author.name));

          break;
        }

        default:
          break;
      }
    });
  }

  //add publication date
  const publicationDateNode = doc.createElement('publication_date');
  graphNode.appendChild(publicationDateNode);

  publicationDateNode.setAttribute('media_type', 'online');

  publicationDateNode
    .appendChild(doc.createElement('year'))
    .appendChild(
      doc.createTextNode(new Date(graph.datePublished).getFullYear())
    );

  // add doi
  const doiDataNode = doc.createElement('doi_data');
  graphNode.appendChild(doiDataNode);

  doiDataNode
    .appendChild(doc.createElement('doi'))
    .appendChild(
      doc.createTextNode(
        graph.doi ||
          (graph.slug && `${SA_DOI_PREFIX}/${graph.slug}`) ||
          `${SA_DOI_PREFIX}/${unprefix(getId(graph))}`
      )
    );

  //Note, graphs _must_ have a url to register a doi
  //use the slug to construct the graph url if there is not one
  const graphUrl =
    graph.url || (graph.slug && `${periodicalUrl}/${graph.slug}`);

  doiDataNode
    .appendChild(doc.createElement('resource'))
    .appendChild(doc.createTextNode(graphUrl));

  //Note, citations _must_ be added to the xml _before_ the component list (otherwise will register as an error on crossref)

  //add unique citations
  const citations = [...new Set(arrayify(mainEntity.citation))]
    .map(citationId => nodeMap[citationId])
    .filter(Boolean);

  if (citations) {
    //create container for citations
    const citationList = doc.createElement('citation_list');
    graphNode.appendChild(citationList);

    //current elements accepted for citation tagging deposits are listed here: https://support.crossref.org/hc/en-us/articles/215578403-Adding-references-to-your-metadata-record (they apply to ScholarlyArticle, Book, Chapter, and Report types)

    //we may want to only register these types of citations
    // const acceptedTypes = ['ScholarlyArticle', 'Book', 'Chapter', 'Report'];
    // citations.filter(cit => acceptedTypes.includes(cit['@type']) || !!cit.doi);

    citations
      .filter(citation => citation['@type'] !== 'TargetRole')
      .forEach(citation => {
        //add top level elements common to all types
        const citationNode = doc.createElement('citation');
        citationList.appendChild(citationNode);
        citationNode.setAttribute('key', unprefix(citation['@id'])); //must be unique

        //add doi
        if (citation.doi) {
          citationNode
            .appendChild(doc.createElement('doi'))
            .appendChild(doc.createTextNode(citation.doi));
        }

        //TODO check that isbn formatting is validated/reformatted upstream
        const isbn =
          citation.isbn &&
          citation.isbn.match(/(978-)?\d[\d -]+[\dX]/) &&
          citation.isbn.match(/(978-)?\d[\d -]+[\dX]/)[0];

        //add isbn
        if (isbn) {
          citationNode
            .appendChild(doc.createElement('isbn'))
            .appendChild(doc.createTextNode(isbn));
        }

        //add author
        const citationAuthors =
          citation.author &&
          arrayify(citation.author)
            .map(authorId => nodeMap[authorId])
            .filter(Boolean)
            .filter(author => {
              return (
                (author['@type'] === 'Person' ||
                  author['@type'] === 'Organization') &&
                authorProps.some(p => author[p])
              );
            });

        if (citationAuthors) {
          //Note, author name should be deposited as organization name (if organization) or first author familyName (if Person)
          citationAuthors && citationAuthors[0]['@type'] === 'Organization'
            ? citationNode
                .appendChild(doc.createElement('author'))
                .appendChild(doc.createTextNode(citationAuthors[0].name))
            : citationNode
                .appendChild(doc.createElement('author'))
                .appendChild(doc.createTextNode(citationAuthors[0].familyName));
        }

        //add date published
        const year =
          citation.datePublished &&
          citation.datePublished['@value'] &&
          citation.datePublished['@value'].toString().match(/^[0-9]{4}/)[0]; //all datePublished types start with a four digit year
        if (year) {
          citationNode
            .appendChild(doc.createElement('cYear'))
            .appendChild(doc.createTextNode(year));
        }

        //add page numbers
        if (citation.pageStart || citation.pagination) {
          if (citation.pageStart) {
            citationNode
              .appendChild(doc.createElement('first_page'))
              .appendChild(doc.createTextNode(citation.pageStart));
          }

          // Note we do not control the form of pagination, so it can either be first page or a range of pages
          //TODO we may want to try to extract at least first page based on the presence of a `-`, etc.
          else {
            citationNode
              .appendChild(doc.createElement('first_page'))
              .appendChild(doc.createTextNode(citation.pagination));
          }
        }

        switch (citation['@type']) {
          case 'ScholarlyArticle': {
            //`article_title` includes journal article, conference paper, and book chapter title (from https://support.crossref.org/hc/en-us/articles/215578403-Adding-references-to-your-metadata-record)
            if (citation.name) {
              citationNode
                .appendChild(doc.createElement('article_title'))
                .appendChild(doc.createTextNode(citation.name));
            }

            // add part names for issue, volume, and periodical
            let container = citation.isPartOf && nodeMap[citation.isPartOf];

            while (container) {
              //there may be several nested isPart of for the issue, volume, and periodical
              switch (container['@type']) {
                case 'PublicationIssue': {
                  citationNode
                    .appendChild(doc.createElement('issue'))
                    .appendChild(doc.createTextNode(container.issueNumber));
                  break;
                }

                case 'PublicationVolume': {
                  citationNode
                    .appendChild(doc.createElement('volume'))
                    .appendChild(doc.createTextNode(container.volumeNumber));
                  break;
                }

                case 'Periodical': {
                  citationNode
                    .appendChild(doc.createElement('journal_title'))
                    .appendChild(doc.createTextNode(container.name));
                  break;
                }
              }

              //get next container
              container = container.isPartOf && nodeMap[container.isPartOf];
            }

            break;
          }

          case 'Chapter': {
            //`article_title` includes journal article, conference paper, and book chapter title (from https://support.crossref.org/hc/en-us/articles/215578403-Adding-references-to-your-metadata-record)
            if (citation.name) {
              citationNode
                .appendChild(doc.createElement('article_title'))
                .appendChild(doc.createTextNode(citation.name));
            }

            // add part names for containing book volume and title
            let container = citation.isPartOf && nodeMap[citation.isPartOf];

            while (container) {
              switch (container['@type']) {
                case 'PublicationVolume': {
                  citationNode
                    .appendChild(doc.createElement('volume'))
                    .appendChild(doc.createTextNode(container.volumeNumber));
                  break;
                }

                case 'Book': {
                  citationNode
                    .appendChild(doc.createElement('volume_title')) //note, we do not have enough information to know if a book is part of a volume or series, so we use volume_title in all cases as there is no generic 'book title' element under citation
                    .appendChild(doc.createTextNode(container.name));

                  break;
                }
              }

              //get next container
              container = container.isPartOf && nodeMap[container.isPartOf];
            }

            //add edition number (note this must not include 'edition', etc, only the number)

            const bookEditionNumber =
              citation.bookEdition &&
              citation.bookEdition.toString().match(/\d+/) &&
              citation.bookEdition.toString().match(/\d+/)[0];
            if (bookEditionNumber) {
              citationNode
                .appendChild(doc.createElement('edition_number'))
                .appendChild(doc.createTextNode(bookEditionNumber));
            }

            break;
          }

          case 'Book': {
            if (citation.name) {
              citationNode
                .appendChild(doc.createElement('volume_title')) //note, we do not have enough information to know if a book is part of a volume or series, so we use volume_title in all cases as there is no generic 'book title' element under citation
                .appendChild(doc.createTextNode(citation.name));
            }

            //add volume number
            if (
              citation.isPartOf &&
              nodeMap[citation.isPartOf] &&
              nodeMap[citation.isPartOf]['@type'] === 'PublicationVolume' &&
              !!nodeMap[citation.isPartOf].volumeNumber
            ) {
              citationNode
                .appendChild(doc.createElement('volume'))
                .appendChild(
                  doc.createTextNode(nodeMap[citation.isPartOf].volumeNumber)
                );
            }

            //add edition number (note this must not include 'edition', etc, only the number)

            const bookEditionNumber =
              citation.bookEdition &&
              citation.bookEdition.toString().match(/\d+/) &&
              citation.bookEdition.toString().match(/\d+/)[0];
            if (bookEditionNumber) {
              citationNode
                .appendChild(doc.createElement('edition_number'))
                .appendChild(doc.createTextNode(bookEditionNumber));
            }
            break;
          }
          //for all other types we add as much structured data as possible rather than dumping the entire reference in an unstructured_citation given we do have structured data (this is what is recommended for datasets in references for example: https://www.crossref.org/blog/how-do-you-deposit-data-citations/).
          default: {
            if (citation.name) {
              citationNode
                .appendChild(doc.createElement('article_title'))
                .appendChild(doc.createTextNode(citation.name));
            }

            // add part names for issue number, volume number, periodical, or volume title
            let container = citation.isPartOf && nodeMap[citation.isPartOf];

            while (container) {
              //there may be several nested isPart of for the issue, volume, and periodical
              switch (container['@type']) {
                case 'PublicationIssue': {
                  citationNode
                    .appendChild(doc.createElement('issue'))
                    .appendChild(doc.createTextNode(container.issueNumber));
                  break;
                }

                case 'PublicationVolume': {
                  citationNode
                    .appendChild(doc.createElement('volume'))
                    .appendChild(doc.createTextNode(container.volumeNumber));
                  break;
                }

                case 'Periodical': {
                  citationNode
                    .appendChild(doc.createElement('journal_title'))
                    .appendChild(doc.createTextNode(container.name));
                  break;
                }

                case 'Book': {
                  citationNode
                    .appendChild(doc.createElement('volume_title')) //note, we do not have enough information to know if a book is part of a volume or series, so we use volume_title in all cases as there is no generic 'book title' element under citation
                    .appendChild(doc.createTextNode(container.name));

                  break;
                }
              }

              //get next container
              container = container.isPartOf && nodeMap[container.isPartOf];
            }

            const bookEditionNumber =
              citation.bookEdition &&
              citation.bookEdition.toString().match(/\d+/) &&
              citation.bookEdition.toString().match(/\d+/)[0];
            if (bookEditionNumber) {
              citationNode
                .appendChild(doc.createElement('edition_number'))
                .appendChild(doc.createTextNode(bookEditionNumber));
            }
          }
        }
      });
  }

  // add graph parts
  const parts = getParts(mainEntity, nodeMap).filter(
    node => node.doi && node.alternateName
  );

  if (parts) {
    const componentListNode = doc.createElement('component_list');
    graphNode.appendChild(componentListNode);

    parts.forEach(part => {
      let componentNode = doc.createElement('component');
      componentListNode.appendChild(componentNode);

      componentNode.setAttribute('parent_relation', 'isPartOf'); //other relations are 'isReferencedBy', 'isRequiredBy', and 'isTranslationOf'

      let description = textify(part.alternateName);
      if (part.caption || part.description) {
        description += `: ${textify(part.caption || part.description)}`;
      }

      componentNode
        .appendChild(doc.createElement('description'))
        .appendChild(doc.createTextNode(description));

      // add doi to parts
      let partDoiNode = doc.createElement('doi_data');
      componentNode.appendChild(partDoiNode);

      partDoiNode
        .appendChild(doc.createElement('doi'))
        .appendChild(doc.createTextNode(part.doi));

      // Parts _must_ have a url to register a doi
      const partUrl = `${graphUrl}#${
        part.alternateName
          ? slug(part.alternateName, {
              symbols: false,
              lower: true
            })
          : unprefix(getId(part))
      }`;

      partDoiNode
        .appendChild(doc.createElement('resource'))
        .appendChild(doc.createTextNode(partUrl));
    });
  }

  const xml = new XMLSerializer().serializeToString(doc);
  return xml;
}

async function registerCrossrefDois(
  graphWithDois,
  periodical,
  {
    crossrefDoiRegistrationUrl,
    crossrefDoiRegistrationUsername,
    crossrefDoiRegistrationPassword
  } = {}
) {
  // See https://support.crossref.org/hc/en-us/articles/214960123-Using-HTTPS-to-POST-Files
  // for testing use: https://test.crossref.org/servlet
  // for prod use: https://doi.crossref.org/servlet

  return new Promise((resolve, reject) => {
    let xml;
    try {
      xml = getCrossrefXml(graphWithDois, periodical);
    } catch (err) {
      reject(
        createError(
          400,
          `getCrossrefXml could not get XML from graph ${getId(graphWithDois)}`
        )
      );
    }

    request.post(
      {
        url: crossrefDoiRegistrationUrl,
        formData: {
          login_id: crossrefDoiRegistrationUsername,
          login_passwd: crossrefDoiRegistrationPassword,
          fname: {
            value: Buffer.from(xml),
            options: {
              filename: `${unprefix(getScopeId(graphWithDois))}.xml`,
              contentType: 'text/xml',
              contentLength: Buffer.byteLength(xml)
            }
          }
        }
      },
      (err, resp, body) => {
        // check https://test.crossref.org/servlet/useragent to see crossref processing
        // console.log(err, resp && resp.statusCode, body);
        if (err) return reject(err);
        if (resp.statusCode >= 400) {
          reject(createError(resp.statusCode, body));
        } else {
          resolve(body);
        }
      }
    );
  });
}
