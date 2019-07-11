import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { getDocs } from '../low';

export default function getLatestReleasesByIssueId(
  issue,
  { store } = {},
  callback
) {
  this.view.get(
    {
      url: '/graphByIsPartOfId',
      qs: {
        key: JSON.stringify(getId(issue)),
        reduce: false,
        include_docs: true
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }
      const graphs = getDocs(body).filter(graph => {
        const [scope, type, version] = parseIndexableString(graph._id);
        return type === 'release' && version === 'latest';
      });
      callback(null, graphs);
    }
  );
}
