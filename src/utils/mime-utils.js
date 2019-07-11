import { getNodeMap, arrayify, getId } from '@scipe/jsonld';
import ds3Mime from '@scipe/ds3-mime';
import schema from './schema';

/**
 * Generate a value for the `accept` attribute of an HTML <input>
 */
export function getFileInputAccept(
  encodingOrResource = {},
  releaseRequirement // `SubmissionReleaseRequirement` or `ProductionReleaseRequirement`
) {
  let accept;

  // handle case when `encodingOrResource` is a resource
  if (
    !schema.is(encodingOrResource, 'MediaObject') &&
    schema.is(encodingOrResource, 'CreativeWork')
  ) {
    const resource = encodingOrResource;

    // get the root encoding
    const encodings = arrayify(resource.distribution || resource.encoding);
    const nodeMap = getNodeMap(encodings);

    let rootEncoding = encodings[0];
    if (!rootEncoding) return accept;
    let tmp;
    while ((tmp = nodeMap[getId(rootEncoding.isBasedOn)])) {
      rootEncoding = tmp;
    }

    return getFileInputAccept(rootEncoding);
  }

  // From here on, `encodingOrResource` is an encoding
  const encoding = encodingOrResource;

  if (schema.is(encoding, 'ImageObject')) {
    accept = 'image/*';
  } else if (schema.is(encoding, 'VideoObject')) {
    accept = 'video/*';
  } else if (schema.is(encoding, 'AudioObject')) {
    accept = 'audio/*';
  } else if (schema.is(encoding, 'DocumentObject')) {
    if (releaseRequirement === 'ProductionReleaseRequirement') {
      accept = ds3Mime;
    } else {
      accept = `${ds3Mime},application/pdf`;
    }
  } else if (encoding.fileFormat) {
    accept = encoding.fileFormat.split(';')[0].trim();
  }

  return accept || undefined; // we don't want empty string
}

export function getCreativeWorkTypeFromMime(mimeType = '') {
  const dataset = new Set([
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/tab-separated-values',
    'application/json',
    'application/ld+json',
    'application/x-ldjson',
    'application/xml',
    'application/rdf+xml',
    'text/n3',
    'text/turtle',
    'application/zip',
    'application/gzip',
    'application/x-gzip',
    'application/x-gtar',
    'application/x-tgz',
    'application/x-tar'
  ]);

  const scholarlyArticle = new Set([
    // TODO scienceai archive
    ds3Mime,
    'application/rtf',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/x-latex'
  ]);

  // For now this is limited to Math
  // TODO subtype for chemistry
  const formula = new Set([
    'application/mathml-presentation+xml',
    'application/mathml-content+xml',
    'application/mathml+xml'
  ]);

  // TODO find a better way
  const languageMimeSuffixes = [
    'javascript',
    'ecmascript',
    'x-asm',
    'x-c',
    'x-c++',
    'x-fortran',
    'x-java',
    'x-java-source',
    'x-pascal',
    'x-clojure',
    'x-coffeescript',
    'x-go',
    'x-ocaml',
    'x-scala',
    'x-python',
    'x-r',
    'x-rust',
    'x-erlang',
    'x-julia',
    'x-perl'
  ];
  const softwareSourceCode = new Set(
    languageMimeSuffixes
      .map(l => `text/${l}`)
      .concat(languageMimeSuffixes.map(l => `application/${l}`))
  );

  mimeType = mimeType.split(';')[0].trim();
  const type = mimeType.split('/')[0];

  if (type === 'image') {
    return 'Image';
  } else if (type === 'video') {
    return 'Video';
  } else if (type === 'audio') {
    return 'Audio';
  } else if (dataset.has(mimeType)) {
    return 'Dataset';
  } else if (scholarlyArticle.has(mimeType)) {
    return 'ScholarlyArticle';
  } else if (softwareSourceCode.has(mimeType)) {
    return 'SoftwareSourceCode';
  } else if (formula.has(mimeType)) {
    return 'Formula';
  } else {
    return 'CreativeWork';
  }
}

export function getEncodingTypeFromMime(mimeType = '') {
  const resourceType = getCreativeWorkTypeFromMime(mimeType);
  switch (resourceType) {
    case 'Image':
      return 'ImageObject';
    case 'Audio':
      return 'AudioObject';
    case 'Video':
      return 'VideoObject';
    case 'Dataset':
      return 'DataDownload';
    case 'Article':
    case 'ScholarlyArticle':
      return 'DocumentObject';
    case 'SoftwareSourceCode':
      return 'SoftwareSourceCodeObject';
    case 'Formula':
      return 'FormulaObject';
    default:
      return 'MediaObject';
  }
}
