import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getDocs } from '../low';
import getScopeId from '../utils/get-scope-id';

export default function getLatestReleasesCoveredByIssue(
  issue,
  { store } = {},
  callback
) {
  const [startDate, endDate] = (issue.temporalCoverage || '').split('/', 2);
  const journalId = getId(issue.isPartOf) || getScopeId(issue);

  this.view.get(
    {
      url: '/latestReleaseByJournalIdAndDatePublished',
      qs: {
        startkey: JSON.stringify([journalId, new Date(startDate).getTime()]),
        endkey: JSON.stringify([journalId, new Date(endDate).getTime()]),
        reduce: false,
        include_docs: true
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
