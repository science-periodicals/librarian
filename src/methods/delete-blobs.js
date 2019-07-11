import { arrayify, getId } from '@scipe/jsonld';
import asyncMap from 'async/map';
import schema from '../utils/schema';

/**
 * `docs` is a list of docs or values that will be deleted
 */
export default function deleteBlobs(docs, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = undefined;
  }
  opts = opts || {};

  // props containing  that need to trigger blob deletion
  const encodings = [];
  arrayify(docs).forEach(doc => {
    addEncodings(encodings, doc);
  });

  // TODO smarter error handling, right now we don't care if blobs remains
  asyncMap(
    encodings,
    (encoding, cb) => {
      this.blobStore.delete(encoding, (err, deleteActions) => {
        cb(null, arrayify(deleteActions)[0]);
      });
    },
    (err, deleteActions) => {
      if (err) return callback(err);
      callback(null, deleteActions.filter(Boolean));
    }
  );
}

function isBlobEncoding(doc = {}) {
  return (
    getId(doc) &&
    doc.contentUrl &&
    doc.contentUrl.startsWith('/encoding/') &&
    doc.encodesCreativeWork &&
    schema.is(doc, 'MediaObject')
  );
}

function addEncodings(encodings, doc) {
  if (isBlobEncoding(doc)) {
    encodings.push(doc);
  }

  const blobProps = [
    'logo',
    'style',
    'encoding',
    'distribution',
    'thumbnail',
    'image',
    'video',
    'audio'
  ];

  blobProps.forEach(prop => {
    if (doc && doc[prop]) {
      addEncodings(encodings, doc[prop]);
    }
  });
}
