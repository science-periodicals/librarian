import createError from '@scipe/create-error';
import { arrayify } from '@scipe/jsonld';
import { getDocs } from '../low';
import { getAgentId } from '../utils/schema-utils';

export default function getUserOrganizations(agent, opts, callback) {
  if (!callback) {
    callback = opts;
    opts = undefined;
  }
  opts = opts || {};

  const { fromPeriodicalData } = opts;
  const userId = getAgentId(agent);

  if (fromPeriodicalData) {
    // users who are editors or producers of a journal whose publisher prop points to an org
    this.view.get(
      {
        url: '/organizationMembers',
        qs: {
          startkey: JSON.stringify([userId, '']),
          endkey: JSON.stringify([userId, '\ufff0']),
          reduce: true,
          include_docs: false,
          group: true
        },
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return callback(err);
        // body is:
        // { rows:
        //   [ { key: [ 'user:peter', 'org:org1' ], value: 1 },
        //     { key: [ 'user:peter', 'org:org2' ], value: 1 } ] }

        const orgIds = Array.from(
          new Set(
            arrayify(body.rows)
              .map(row => row.key[1])
              .filter(Boolean)
          )
        );
        callback(null, orgIds);
      }
    );
  } else {
    // only org where the user is directly listed as member
    this.view.get(
      {
        url: '/organizationByUserId',
        qs: {
          key: JSON.stringify(userId),
          reduce: false,
          include_docs: true
        },
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return callback(err);
        const orgs = getDocs(body);
        callback(null, orgs);
      }
    );
  }
}
