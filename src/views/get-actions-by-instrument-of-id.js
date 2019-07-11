import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';
import { getInstrumentOfId } from '../utils/schema-utils';

export default function getActionsByInstrumentOfId(
  instrumentOfId,
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

  instrumentOfId = getId(instrumentOfId);

  this.view.get(
    {
      url: '/actionsByInstrumentOfId',
      qs: {
        reduce: false,
        include_docs: true,
        key: JSON.stringify(instrumentOfId)
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      // Because of CouchDB 2.0 clustering the view may be out of date and
      // miss some recent actions. We try to mitigate that here for workflow action as the
      // some action handler may have pre-fetched some actions already
      let payload = getDocs(body);
      if (store) {
        store.add(payload);

        payload = store
          .getAll()
          .filter(doc => getInstrumentOfId(doc) === instrumentOfId);
      }

      return callback(null, payload);
    }
  );
}
