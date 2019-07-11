import querystring from 'querystring';
import { arrayify } from '@scipe/jsonld';

export function escapeLucene(search) {
  return search.replace(/([+&|!(){}[\]^"~*?:\\\/-])/g, '\\$1');
}

export function formatSearchTerm(search) {
  if (!search) return '""';
  const isMulti = search.split(/\W+/).length > 1;
  search = escapeLucene(search);
  return isMulti ? `"${search}"` : `${search}~`;
}

export function getTextQuery(inputValue, fields, { tokenize = true } = {}) {
  if (!inputValue) return;
  fields = arrayify(fields);
  if (!fields.length) return;

  let searchQuery = fields
    .map(index => `${index}:${formatSearchTerm(inputValue)}`)
    .join(' OR ');

  if (tokenize) {
    const tokens = inputValue.split(/\s+/).filter(t => t);
    if (tokens.length > 1) {
      tokens.forEach(token => {
        fields.forEach(index => {
          searchQuery += ` OR ${index}:${formatSearchTerm(token)}`;
          searchQuery += ` OR ${index}:${escapeLucene(token)}*`;
        });
      });
    }
  }

  return searchQuery;
}

/**
 * Search API return a nextUrl string * if we use POST to make a new search
 * how of it we need to convert it into POST body data
 */
export function parseNextUrl(nextUrl) {
  const [base, qs] = nextUrl.split('?');
  const query = querystring.parse(qs);
  const body = {};
  const params = {};
  Object.keys(query).forEach(key => {
    const value = query[key];

    switch (key) {
      case 'limit':
        body[key] = parseInt(value, 10);
        break;

      case 'bookmark':
      case 'potentialActions':
      case 'query':
      case 'q':
        body[key] = value;
        break;

      case 'nodes':
      case 'includeDocs':
      case 'descending':
        body[key] = String(value) === 'true';
        break;

      case 'hydrate':
      case 'counts':
      case 'sort':
      case 'ranges':
      case 'drilldown':
      case 'includeFields':
        body[key] = JSON.parse(value);
        break;

      default:
        params[key] = value;
        break;
    }
  });

  return { url: `${base}?${querystring.stringify(params)}`, body };
}
