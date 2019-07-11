import once from 'once';
import omit from 'lodash/omit';
import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';

export default function update(
  doc,
  f, // a function to update `doc`. `f` is called with f(latestDoc) and returns an updated doc or a Promise of an updated doc
  // Note the typically optional `opts` doc is required here as otherwise `addPromiseSupport` would faild as `f` is a function
  {
    store,
    ifMatch, // the _rev of the doc that needs to match for the update to be applied (usefull if the update function is not safe (re-entrant / idempotent)
    lucene = true // preserve @lucene when fetching Graph
  } = {},
  callback
) {
  callback = once(callback);

  let retried = 0;

  // Note: we GET the doc first to be sure that we get the bare one
  const sync = (doc, callback) => {
    this.get(
      doc,
      { store, acl: false, lucene, fromCache: false },
      (err, doc) => {
        if (err) {
          if (err.code === 404 && store && store.has(doc)) {
            // Try to recover from 404 if the `doc` is present in the store
            // This can happen due to CouchDB 2.x clustered nature / eventual consistency
            doc = store.get(doc);
          } else {
            return callback(err);
          }
        }

        if (ifMatch && doc._rev !== ifMatch) {
          return callback(
            createError(
              409,
              `Mismatch _rev for ${getId(doc)} got: ${ifMatch}, retrieved: ${
                doc._rev
              }`
            )
          );
        }

        let v;
        try {
          v = f(doc);
        } catch (err) {
          return callback(err);
        }

        if (v == null) {
          return callback(
            createError(400, 'update function resulted in null or undefined')
          );
        }

        Promise.resolve(v)
          .then(updatedDoc => {
            this.put(updatedDoc, { store }, (err, putUpdatedDoc) => {
              if (err) {
                if (
                  retried < 10 && // TODO add 10 -> maxRetry exposed as option
                  (err.code === 200 ||
                    err.code === 201 ||
                    err.code === 202 ||
                    err.code === 409)
                ) {
                  retried++;

                  return setTimeout(() => {
                    sync(doc, callback); // retry with original `doc`
                  }, 250 + Math.floor(Math.random() * 250));
                } else {
                  return callback(err);
                }
              }

              callback(null, omit(putUpdatedDoc, ['@lucene']));
            });
          })
          .catch(callback);
      }
    );
  };

  sync(doc, callback);
}
