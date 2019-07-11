import ds3Mime from '@scipe/ds3-mime';

/**
 * `encoding` can be the contentType
 */
export default function isArchive(encoding = {}) {
  const fileFormat =
    typeof encoding === 'string' ? encoding : encoding.fileFormat || '';

  const mimeType = fileFormat.split(';')[0].trim();

  // TODO add SA archive
  return (
    mimeType === 'application/vnd.scienceai.jats+tgz' || mimeType === ds3Mime
  );
}
