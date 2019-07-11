import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getChildCommentActions(
  parentCommentAction,
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

  const parentItemId = getId(parentCommentAction.resultComment);

  if (!parentItemId) {
    return callback(null, []);
  }

  this.view.get(
    {
      url: '/commentActionByCommentParentItem',
      qs: {
        key: JSON.stringify(parentItemId),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      // Because of CouchDB 2.0 clustering the view may be out of date and
      // miss some recent actions. We try to mitigate that here as
      // some action may have pre-fetched in the store already
      let payload = getDocs(body);
      if (store) {
        store.add(payload);

        payload = store.getAll().filter(doc => {
          if (
            doc._id &&
            parseIndexableString(doc._id)[1] === 'action' &&
            doc['@type'] === 'CommentAction' &&
            doc.resultComment &&
            doc.resultComment.parentItem &&
            getId(doc.resultComment.parentItem) === parentItemId
          ) {
            return true;
          }

          return false;
        });
      }

      callback(null, payload);
    }
  );
}
