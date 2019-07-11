import { createNash as _createNash } from '@scipe/jsonld';
import omit from 'lodash/omit';

export default function createNash(release, callback) {
  _createNash(
    omit(release, [
      '_id',
      '_rev',
      'contentChecksum',
      'potentialAction',
      'author',
      'contributor',
      'reviewer',
      'editor',
      'producer',
      'hasDigitalDocumentPermission'
    ]),
    (err, nash) => {
      if (err) {
        return callback(err);
      }

      callback(
        null,
        Object.assign({}, release, {
          contentChecksum: {
            '@type': 'Checksum',
            checksumAlgorithm: 'nash',
            checksumValue: nash
          }
        })
      );
    }
  );
}
