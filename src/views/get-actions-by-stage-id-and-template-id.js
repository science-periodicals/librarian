import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getActionsByStageIdAndTemplateId(
  stageId,
  templateId, // can be `null`
  { store } = {},
  callback
) {
  stageId = getId(stageId);
  templateId = getId(templateId);

  let query;
  if (templateId) {
    query = { key: JSON.stringify([stageId, templateId]) };
  } else {
    query = {
      startkey: JSON.stringify([stageId, '']),
      endkey: JSON.stringify([stageId, '\ufff0'])
    };
  }

  this.view.get(
    {
      url: '/actionByStageIdAndTemplateId',
      qs: Object.assign(
        {
          reduce: false,
          include_docs: true
        },
        query
      ),
      json: true
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
              parseIndexableString(doc._id)[1] === 'action' &&
              getId(doc.resultOf) === stageId &&
              (templateId == null || getId(doc.instanceOf) === templateId)
          );
      }

      callback(null, payload);
    }
  );
}
