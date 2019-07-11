import createError from '@scipe/create-error';
import { arrayify, getId } from '@scipe/jsonld';
import asyncParallel from 'async/parallel';
import { getRootPartId } from '../utils/schema-utils';

/**
 * Get the publication issue whose temporal coverage encompass the release datePublished
 * see https://stackoverflow.com/questions/23509270/couchdb-map-function-to-get-the-data-in-between-two-dates
 */
export default function getLatestReleasePublicationIssueId(
  release,
  { store } = {},
  callback
) {
  const journalId = getRootPartId(release);

  if (!release.datePublished || !journalId) {
    return callback(null, null);
  }

  // the view queried return payload like:

  // { total_rows: 1,
  //   offset: 0,
  //   rows:
  //     [ { id: '54journal:periodicalId\u00014issue\u00014aa733939-47a6-46b5-b237-26b23dc90e2e\u0001\u0001',
  //         key: [journal:periodicalId, 946702800000],
  //         value: 'issue:1@periodicalId' } ] }

  asyncParallel(
    {
      startSet: cb => {
        this.view.get(
          {
            url: '/publicationIssueByJournalIdAndTemporalCoverageStart',
            qs: {
              endkey: JSON.stringify([
                journalId,
                new Date(release.datePublished).getTime()
              ]),
              reduce: false,
              include_docs: false
            },
            json: true
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return cb(err);
            }

            const startSet = new Set(
              arrayify(body.rows)
                .map(row => row && row.value)
                .filter(Boolean)
            );
            cb(null, startSet);
          }
        );
      },
      endSet: cb => {
        this.view.get(
          {
            url: '/publicationIssueByJournalIdAndTemporalCoverageEnd',
            qs: {
              startkey: JSON.stringify([
                journalId,
                new Date(release.datePublished).getTime()
              ]),
              reduce: false,
              include_docs: false
            },
            json: true
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return cb(err);
            }

            const endSet = new Set(
              arrayify(body.rows)
                .map(row => row && row.value)
                .filter(Boolean)
            );
            cb(null, endSet);
          }
        );
      }
    },
    (err, { startSet, endSet } = {}) => {
      if (err) return callback(err);

      // the issueId is the at the intersection of the 2 sets
      const issueIds = Array.from(startSet).filter(id => endSet.has(id));
      if (!issueIds.length) {
        callback(null, null);
      } else if (issueIds.length === 1) {
        callback(null, issueIds[0]);
      } else {
        // should not happen, if it does smtg went wrong
        callback(
          createError(
            500,
            `overlapping chronological issues ${issueIds.join(
              ', '
            )} for ${getId(release)}`
          )
        );
      }
    }
  );
}
