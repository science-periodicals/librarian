import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getActiveInviteActionsByPurposeId(
  purposeId, // can be a list
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  const purposeIds = arrayify(purposeId)
    .map(getId)
    .filter(Boolean);

  this.view.post(
    {
      url: '/activeInviteActionsByPurposeId',
      qs: {
        reduce: false,
        include_docs: true
      },
      json: { keys: purposeIds }
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let payload = getDocs(body);
      if (store) {
        // add current payload to store first
        store.add(payload);
        // reconstruct the payload from the store that may have more data
        // (CouchDB 2.x & eventual consistency)
        payload = store
          .getAll()
          .filter(
            doc =>
              doc['@type'] === 'InviteAction' &&
              doc.actionStatus === 'ActiveActionStatus' &&
              arrayify(doc.purpose).some(purpose =>
                purposeIds.some(_purposeId => _purposeId === getId(purpose))
              )
          );
      }

      return callback(null, payload);
    }
  );
}
