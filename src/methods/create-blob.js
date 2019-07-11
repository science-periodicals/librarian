import once from 'once';
import mmmagic from 'mmmagic';
import through2 from 'through2';
import createError from '@scipe/create-error';
import ds3Mime from '@scipe/ds3-mime';
import { getEncodingTypeFromMime } from '../utils/mime-utils';

export default function createBlob(
  readableDataStream,
  {
    compress,
    graphId,
    resourceId,
    encodingId,
    type, // encoding type (we can't descrtucture `@type`)
    name,
    creator,
    fileFormat,

    // pass through
    isBasedOn,
    isNodeOf,
    encodesCreativeWork
  } = {},
  callback
) {
  callback = once(callback);

  if (!type && fileFormat) {
    type = getEncodingTypeFromMime(fileFormat);
  }

  const data = [];
  let spy = through2(function(chunk, encoding, cb) {
    if (data.length < 100) {
      data.push(chunk);
    }
    this.push(chunk);
    return cb();
  });

  const writeStream = this.blobStore.put(
    {
      graphId,
      resourceId,
      encodingId,
      type,
      name,
      creator,
      fileFormat,
      isNodeOf,
      isBasedOn,
      encodesCreativeWork,
      compress
    },
    (err, encoding) => {
      if (err) {
        return callback(err);
      }

      const buffered = Buffer.concat(data);
      handleFileFormat.call(
        this,
        fileFormat,
        buffered,
        (err, correctedFileFormat) => {
          if (err) {
            return this.deleteBlob(
              {
                graphId,
                resourceId,
                encodingId
              },
              errBlob => {
                if (errBlob) {
                  this.log.error(errBlob, 'could not delete blob');
                }
                callback(err);
              }
            );
          }

          if (correctedFileFormat !== fileFormat) {
            encoding['@type'] = getEncodingTypeFromMime(correctedFileFormat);
            encoding.fileFormat = correctedFileFormat;
          }

          callback(null, encoding);
        }
      );
    }
  );

  readableDataStream
    .on('error', err => {
      callback(createError(400, err));
    })
    .pipe(spy)
    .on('error', err => {
      callback(createError(400, err));
    })
    .pipe(writeStream);
}

function handleFileFormat(fileFormat, buffered, callback) {
  const cType = (fileFormat || '').split(';')[0].trim();
  const type = cType.split('/')[0].trim();
  if (
    cType === 'application/octet-stream' ||
    cType === 'text/plain' ||
    cType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    cType === ds3Mime ||
    cType === 'application/msword' ||
    cType === 'application/x-gzip' ||
    cType === 'application/x-tar' ||
    cType === 'application/pdf' ||
    cType === 'application/x-pdf' ||
    type === 'image' ||
    type === 'audio' ||
    type === 'video'
  ) {
    new mmmagic.Magic(mmmagic.MAGIC_MIME_TYPE).detect(
      buffered,
      (err, correctedFileFormat) => {
        if (err) {
          this.log.error(err, 'mmmagic error');
          return callback(null, fileFormat);
        }

        let icType = (correctedFileFormat || '').split(';')[0].trim();
        const iType = (correctedFileFormat || '').split('/')[0].trim();

        // Special case for DS3 as it will be detected as OOXML
        if (
          cType === ds3Mime &&
          icType ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          correctedFileFormat = ds3Mime;
          icType = ds3Mime;
        }

        // Issue a warning when the ctype is defined and there is mismatch
        // TODO should we error in this case ?
        if (
          cType !== 'application/octet-stream' &&
          icType !== 'application/octet-stream' &&
          cType !== icType
        ) {
          this.log.warn(
            { fileFormat, correctedFileFormat },
            `Invalid Content-Type ?: got ${cType} and mmmagic reported ${icType}`
          );
        }

        if (
          cType === 'application/octet-stream' || // we have nothing to loose
          (icType === 'application/octet-stream' && iType === type) // correction / refinement
        ) {
          fileFormat = correctedFileFormat;
        }
        callback(null, fileFormat);
      }
    );
  } else {
    callback(null, fileFormat);
  }
}
