import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getWorkflowActionsByStageId(stageId, opts, callback) {
  if (!callback && typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!opts) opts = {};

  stageId = getId(stageId);

  let query;
  if (opts['@type']) {
    query = { key: JSON.stringify([stageId, opts['@type']]) };
  } else {
    query = {
      startkey: JSON.stringify([stageId, '']),
      endkey: JSON.stringify([stageId, '\ufff0'])
    };
  }

  this.view.get(
    {
      url: '/actionsByWorkflowStageAndType',
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
      const docs = getDocs(body);
      callback(null, docs);
    }
  );
}
