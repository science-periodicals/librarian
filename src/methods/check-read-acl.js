import asyncMap from 'async/map';
import createError from '@scipe/create-error';
import { arrayify } from '@scipe/jsonld';
import { hasPublicAudience } from '../acl';

export default function checkReadAcl(doc, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }

  if (String(opts.acl) === 'false') {
    return callback(null, doc);
  }

  const docs = arrayify(doc);

  // if all the docs are public, we skip the checkAcl part as the
  // user may not be logged in (it is valid to get a public doc anonymously)
  asyncMap(
    docs,
    (doc, cb) => {
      // For public document, we need to not error in case we have no user and acl: true.
      // => if the doc is public (profile, journal, type, event, service etc.) we return early.
      this.checkPublicAvailability(
        doc,
        { store: opts.store },
        (err, isPublic) => {
          if (err) return cb(err);

          cb(null, { doc, isPublic });
        }
      );
    },
    (err, data) => {
      if (err) return callback(err);

      // early return if everything (including potential action (if any)) is public
      if (
        data.every(entry => {
          return (
            entry.isPublic &&
            arrayify(entry.doc.potentialAction).every(action => {
              return (
                // if embedded that's always OK
                !action._id || hasPublicAudience(action, { now: opts.now })
              );
            })
          );
        })
      ) {
        return callback(null, doc);
      }

      this.checkAcl(Object.assign({}, opts, { docs }), (err, check) => {
        // Note: we ignore 403 and 401 errors so that user not logged in can
        // still get access to the public doc
        let acledDocs;
        if (err) {
          if (err.code === 403 || err.code === 401) {
            acledDocs = data
              .filter(entry => entry.isPublic)
              .map(entry => entry.doc);
          } else {
            return callback(err);
          }
        } else {
          acledDocs = data
            .map(entry => {
              return this.checkReadAclSync(entry.doc, {
                isPublic: entry.isPublic,
                check
              });
            })
            .filter(Boolean);
        }

        const payload = Array.isArray(doc) ? acledDocs : acledDocs[0];

        // Note, we still return the filtered safeDocs `payload` in case of error as caller may want to do smtg with them...
        if (acledDocs.length !== docs.length) {
          this.log.debug({ acledDocs, docs }, 'check read acl error');
          return callback(
            createError(
              403,
              `checkReadAcl not allowed: ${acledDocs.length} vs ${
                docs.length
              }; types: ${docs
                .filter(
                  doc =>
                    doc &&
                    !acledDocs.some(_doc => _doc['@type'] === doc['@type'])
                )
                .map(doc => `${doc['@id']} (${doc['@type']})`)
                .filter(Boolean)
                .join(', ')};`
            ),
            payload
          );
        }

        callback(null, payload);
      });
    }
  );
}
