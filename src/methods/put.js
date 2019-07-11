import omit from 'lodash/omit';
import createError from '@scipe/create-error';
import { arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function put(object, opts, callback) {
  if (!callback && typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  if (!opts) opts = {};
  const { force, deleteBlobs, store } = opts;

  const objects = arrayify(object);

  const objectsWithoutIds = objects.some(object => !object._id);
  if (objectsWithoutIds.length) {
    return callback(
      createError(
        400,
        `librarian.put: missing property _id for ${objectsWithoutIds
          .map(object => object['@id'] || object['@type'])
          .join('; ')}`
      )
    );
  }

  let retried = 0;
  let respMap = {}; // used to update rev

  const _put = objects => {
    this.db.post(
      {
        url: '/_bulk_docs',
        json: { docs: objects }
      },
      (err, resp, body) => {
        err = createError(err, resp, body);

        if (err) {
          if (
            force &&
            retried < 10 &&
            (err.code === 200 ||
              err.code === 201 ||
              err.code === 202 ||
              err.code === 409)
          ) {
            retried++;
            arrayify(body).forEach(resp => {
              if (resp && String(resp.ok) === 'true' && resp.id && resp.rev) {
                respMap[resp.id] = resp;
              }
            });

            return setTimeout(() => {
              const erroredIds = new Set(
                arrayify(body)
                  .filter(value => value && value.id && value.error)
                  .map(value => value.id)
              );
              let erroredObjects = objects.filter(object =>
                erroredIds.has(object._id)
              );

              // fetch latest version of the error docs
              this.db.post(
                {
                  url: '/_all_docs',
                  json: { keys: Array.from(erroredIds) },
                  qs: {
                    include_docs: true
                  }
                },
                (err, resp, body) => {
                  if ((err = createError(err, resp, body))) {
                    retried++;
                    if (retried < 10) {
                      _put(erroredObjects);
                    } else {
                      callback(err);
                    }
                  }

                  // !! body cant contain _deleted_ document such as:
                  //  { total_rows: 684,
                  //    rows:
                  //      [ { id: '54node:17fb3a42-f40f-441f-ab7a-905135e8e31c\u00014node\u00014_:27aa5439-1796-41ee-9650-5913cab74678\u0001\u0001',
                  //          key: '54node:17fb3a42-f40f-441f-ab7a-905135e8e31c\u00014node\u00014_:27aa5439-1796-41ee-9650-5913cab74678\u0001\u0001',
                  //          value: { rev: '2-a95d4e83c897c86134ed400a404c0519', deleted: true },
                  //          doc: null } ] }
                  //   As they are deleted they will not make it to the docMap and we use that to filter them out from erroredObjects

                  const docs = getDocs(body);

                  const docMap = docs.reduce((docMap, doc) => {
                    docMap[doc._id] = doc;
                    return docMap;
                  }, {});

                  _put(
                    erroredObjects.map(erroredObject => {
                      const doc = docMap[erroredObject._id];
                      const newObject = doc
                        ? Object.assign({}, erroredObject, {
                            _rev: doc._rev
                          })
                        : omit(erroredObject, '_rev'); // if we could not find it => new so there should not be a _rev

                      return newObject;
                    })
                  );
                }
              );
            }, 250 + Math.floor(Math.random() * 250));
          } else {
            return callback(err);
          }
        } else {
          body.forEach(resp => {
            if (String(resp.ok) === 'true' && resp.id && resp.rev) {
              respMap[resp.id] = resp;
            }
          });

          // !objects is the new objects (contain a subset) `arrayify(object)` contains _all_ the initial docs
          const docs = arrayify(object).map(doc => {
            if (respMap[doc._id] && respMap[doc._id].rev) {
              return Object.assign({}, doc, { _rev: respMap[doc._id].rev });
            } else {
              return doc;
            }
          });

          const payload = Array.isArray(object) ? docs : docs[0];
          if (store) {
            store.add(payload);
          }

          this.syncUniqIds(payload, err => {
            if (err) {
              this.log.fatal({ err, payload }, 'Could not sync uniq ids');
            }
            this.syncWorkflowActionDataSummary(payload, err => {
              if (err) {
                this.log.fatal(
                  { err, payload },
                  'Could not sync workflow action data summary'
                );
              }
              if (deleteBlobs) {
                this.deleteBlobs(
                  docs.filter(doc => doc._deleted && doc._id),
                  err => {
                    if (err) this.log.error({ err }, 'delete blobs errorred');
                    callback(null, payload);
                  }
                );
              } else {
                callback(null, payload);
              }
            });
          });
        }
      }
    );
  };

  _put(objects);
}
