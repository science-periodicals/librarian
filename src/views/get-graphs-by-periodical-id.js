import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getGraphsByPeriodicalId(
  periodical,
  { store } = {},
  callback
) {
  this.view.get(
    {
      url: '/graphByIsPartOfId',
      qs: {
        key: JSON.stringify(getId(periodical)),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const graphs = getDocs(body);
      callback(null, graphs);
    }
  );
}
