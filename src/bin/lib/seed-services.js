import fs from 'fs';
import path from 'path';
import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { createDb, createId } from '../../';

const root = path.resolve(__dirname, '../../../services');
const services = fs.readdirSync(root).map(relPath => {
  return JSON.parse(
    fs.readFileSync(path.join(root, relPath), { encoding: 'utf8' })
  );
});

export default function seedServices(config, callback) {
  const db = createDb(config, { admin: true });

  const docs = services.map(doc => {
    switch (doc['@type']) {
      case 'Organization':
        // TODO fix, that should not be seeded with services
        return Object.assign({}, doc, createId('org', getId(doc)));
      case 'Service':
        return Object.assign({}, doc, createId('service', doc, 'org:scipe'));
      default:
        return doc;
    }
  });

  db.post(
    {
      url: '/_bulk_docs',
      json: {
        docs: docs
      }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        if (err.code === 409) {
          // handle conflicts
          const conflicts = body.filter(row => row.error === 'conflict');

          db.post(
            {
              url: '/_all_docs',
              json: {
                keys: conflicts.map(row => row.id)
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return callback(err);
              }

              const newRevs = body.rows.map(row => {
                const doc = docs.find(doc => doc._id === row.id);
                return Object.assign(doc, { _rev: row.value.rev });
              });

              db.post(
                {
                  url: '/_bulk_docs',
                  json: {
                    docs: newRevs
                  }
                },
                (err, resp, body) => {
                  if ((err = createError(err, resp, body))) {
                    return callback(err);
                  }
                  callback(null, docs);
                }
              );
            }
          );
        } else {
          return callback(err);
        }
      } else {
        return callback(null, docs);
      }
    }
  );
}
