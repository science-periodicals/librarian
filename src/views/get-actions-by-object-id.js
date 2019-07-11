import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

/**
 * See also `getActionsByObjectIdAndType`
 */
export default function getActionsByObjectId(
  objectId,
  { store } = {},
  callback
) {
  objectId = getId(objectId);

  this.view.get(
    {
      url: '/actionByObjectIdAndType',
      qs: {
        reduce: false,
        include_docs: true,
        startkey: JSON.stringify([objectId, '']),
        endkey: JSON.stringify([objectId, '\ufff0'])
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      callback(null, getDocs(body));
    }
  );
}
