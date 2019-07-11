import moment from 'moment';
import isPlainObject from 'lodash/isPlainObject';
import { getId, unrole, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import setId from '../utils/set-id';
import {
  validateDateTimeDuration,
  validateStylesAndAssets
} from '../validators';
import { createLatestPublicationIssueLockId } from '../utils/lock-utils';
import { getAgentId, getObjectId } from '../utils/schema-utils';
import { setEmbeddedIds } from '../utils/embed-utils.js';

/**
 * Create `PublicationIssue`
 * `PublicationIssue` work based on `temporalCoverage` and are used a timestamps in sifter
 * issueNumber and the @id are auto incremented and rely on the same _id hack as for CreateReleaseAction
 *
 * Note: for convenience temporalCoverage can be omitted on creation and only datePublished specified. In
 * this case `datePublished` will be used to generate the end of the temporalCoverage
 */
export default async function handleCreatePublicationIssueAction(
  action,
  { store, triggered, prevAction, strict } = {}
) {
  // validation
  const messages = [];

  if (action.actionStatus !== 'CompletedActionStatus') {
    messages.push(
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const agentId = getAgentId(action.agent);
  if (!agentId) {
    messages.push(`${action['@type']} must have a valid agent`);
  }

  const periodicalId = getObjectId(action);
  if (!periodicalId) {
    messages.push(
      `${action['@type']} must have a valid object pointing to a Periodical`
    );
  }

  let issue = unrole(action.result, 'result');

  // @id will be further validated after locking so that it is guaranteed to match the issueNumber
  if (
    getId(issue) &&
    getId(issue) !== createId('issue', issue, periodicalId)['@id']
  ) {
    messages.push(`${action['@type']} result must have a valid @id`);
  }

  if (!isPlainObject(issue)) {
    issue = { '@id': getId(issue) };
  }

  const forbiddenProps = ['url', 'potentialAction'].filter(p => p in issue);
  if (forbiddenProps.length) {
    messages.push(
      `${
        action['@type']
      } cannot be used to set the following properties: ${forbiddenProps.join(
        ','
      )}.`
    );
  }

  // Note: validateDateTimeDuration will ensure that temporalCoverage is valid and that the end of the time span is _after_ the begining
  messages.push(
    ...validateDateTimeDuration(issue).concat(validateStylesAndAssets(issue))
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  // get latest issue (if any) and periodical so that we can set the @id of the issue

  // Note: we lock _before_ reading the latest issue => by the time we read it
  // we know it's reliable and won't change
  const latest_id = createId('issue', null, periodicalId, true)._id;

  // Note: the same lock key must be used for updating the temporal coverage of the latest issue (and that one only)
  // Note: we check for the existance and unicity of the newly created issue after we have the lock
  let lock;
  try {
    lock = await this.createLock(
      createLatestPublicationIssueLockId(periodicalId),
      { prefix: 'issue', isLocked: null }
    );
  } catch (err) {
    throw createError(423, 'Publication issue creation already in progress');
  }

  try {
    const docs = await this.get([latest_id, periodicalId], {
      store,
      acl: false
    });
    const prevLatest = docs.find(doc => doc._id === latest_id); // may not exists
    const periodical = docs.find(doc => getId(doc) === periodicalId);
    if (!periodical || periodical['@type'] !== 'Periodical') {
      throw createError(
        400,
        `${action['@type']} object must be a valid Periodical`
      );
    }

    if (prevLatest) {
      // _id was latest previously we change it the non latest one
      Object.assign(
        prevLatest,
        createId('issue', getId(prevLatest), periodicalId)
      );

      // issue will become the new latest
      issue._rev = prevLatest._rev;
      delete prevLatest._rev; // prevLatest will be a new document with no prior history
    }

    const nextIssueNumber = prevLatest ? prevLatest.issueNumber + 1 : 1;
    const starts = prevLatest
      ? prevLatest.temporalCoverage.split('/', 2)[1]
      : periodical.dateCreated;

    // if temporalCoverage is not specified we default to datePublished or next month
    const ends = issue.temporalCoverage
      ? issue.temporalCoverage.split('/', 2)[1]
      : issue.datePublished
      ? issue.datePublished
      : moment(starts)
          .add(1, 'months')
          .toISOString();

    if (moment(starts).isAfter(ends) || starts === ends) {
      try {
        await lock.unlock();
      } catch (err) {
        this.log.error(
          { err },
          'could not release lock, but it will auto expire'
        );
      }

      throw createError(
        400,
        `Invalid temporal coverage ${ends} must be after ${starts}`
      );
    }

    // issue is the new latest
    issue = setEmbeddedIds(
      setId(
        Object.assign(
          {
            '@type': 'PublicationIssue'
          },
          issue,
          {
            dateCreated: new Date().toISOString(),
            creator: agentId,
            isPartOf: periodicalId,
            temporalCoverage: `${starts}/${ends}`,
            issueNumber: nextIssueNumber,
            datePublished: ends // We publish issue at the end of their time coverage so that article can be packed till the end
          }
        ),
        createId('issue', nextIssueNumber, periodicalId, true) // new latest
      )
    );

    issue = await this.validateAndSetupNodeIds(issue, { store, strict });

    // check that issue @id doesn't exists already
    const hasUniqId = await this.hasUniqId(getId(issue));
    if (hasUniqId) {
      throw createError(400, `PublicationIssue ${getId(issue)} already exists`);
    } else {
      // maybe smtg went wrong with redis so we also try from CouchDB
      let prevNewIssue;
      try {
        prevNewIssue = await this.get(getId(issue), { acl: false, store });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }
      if (prevNewIssue) {
        throw createError(
          400,
          `PublicationIssue ${getId(issue)} already exists`
        );
      }
    }

    const sourceAgent = findRole(action.agent, periodical, {
      ignoreEndDateOnPublicationOrRejection: true
    });

    const handledAction = Object.assign(
      {
        startTime: new Date().toISOString()
      },
      handleParticipants(action, periodical),
      sourceAgent
        ? { agent: remapRole(sourceAgent, 'agent', { dates: false }) }
        : undefined,
      {
        endTime: new Date().toISOString(),
        actionStatus: 'CompletedActionStatus',
        result: getId(issue)
      },
      createId('action', action['@id'], periodical['@id'])
    );

    var [savedAction, savedIssue, savedPrevLatest] = await this.put(
      [handledAction, issue].concat(arrayify(prevLatest)),
      {
        store,
        force: true
      }
    );

    try {
      await this.syncIssue(savedIssue, { store });
    } catch (err) {
      this.log.error(
        { err, action: savedAction, issue: savedIssue },
        'error syncing issue'
      );
    }
  } catch (err) {
    throw err;
  } finally {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error(
        { err },
        'could not release lock, but it will auto expire'
      );
    }
  }

  return Object.assign(savedAction, {
    result: savedIssue
  });
}
