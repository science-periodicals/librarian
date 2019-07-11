import moment from 'moment';
import isPlainObject from 'lodash/isPlainObject';
import { getId, unrole, arrayify, unprefix } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getAgentId, getObjectId, getRootPartId } from '../utils/schema-utils';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import setId from '../utils/set-id';
import {
  validateDateTimeDuration,
  validateStylesAndAssets
} from '../validators';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { getEmbeddedIssuePart, setEmbeddedIds } from '../utils/embed-utils';

/**
 * Create special publication issue.
 *
 * `SpecialPublicationIssue` must have a  unique id starting with the
 * unprefixed journal id (e.g: issue:joghl-flu)
 *
 * As opposed to PublicationIssue, list of articles part of the issue can be
 * listed in the `hasPart` prop (`temporalCoverage` cannot be used)
 *
 * Note: the article listed in the issue are _not_ mutated and do not point to
 * the issue through the isPartOf property.  This is so that special issues can
 * be deleted easily
 *
 */
export default async function handleCreateSpecialPublicationIssueAction(
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

  if (
    !getId(issue) ||
    getId(issue) !== createId('issue', issue, periodicalId)['@id'] ||
    getId(issue) === createId('issue', 'latest', periodicalId)['@id'] || // "latest" is reserved
    /\d/.test(unprefix(getId(issue)).split('/', 2)[1]) // prevent number so it doesn't clash with PublicationIssue
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

  messages.push(
    ...validateDateTimeDuration(issue).concat(validateStylesAndAssets(issue))
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  // if `hasPart` is provided, we ensure that only proper articles are listed
  const [periodical, ...releases] = await this.get(
    [periodicalId].concat(arrayify(issue.hasPart)),
    { acl: false, store }
  );

  // has to be part of the journal and remove any version + ensure unicity
  const validatedReleases = Array.from(
    new Set(
      releases
        .filter(release => getRootPartId(release) === periodicalId)
        .map(release => getEmbeddedIssuePart(release))
    )
  );

  issue = setEmbeddedIds(
    setId(
      Object.assign(
        {
          '@type': 'SpecialPublicationIssue',
          // TODO maybe remove arbitrary default ? (it ensures that the issue is guaranteed to be published if user forget to set the date later)
          datePublished: moment()
            .add(1, 'months')
            .toISOString() // default
        },
        issue,
        {
          dateCreated: new Date().toISOString(),
          creator: agentId,
          isPartOf: periodicalId
        },
        validatedReleases.length ? { hasPart: validatedReleases } : undefined
      ),
      createId('issue', issue, periodical)
    )
  );

  issue = await this.validateAndSetupNodeIds(issue, { store, strict });

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

  const lock = await this.createLock(getId(issue), {
    prefix: 'create-issue',
    isLocked: async () => {
      const hasUniqId = await this.hasUniqId(getId(issue));

      let prevIssue;
      try {
        prevIssue = await this.get(getId(issue), { store, acl: false });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }

      return hasUniqId || !!prevIssue;
    }
  });

  let savedAction, savedIssue;
  try {
    [savedAction, savedIssue] = await this.put([handledAction, issue], {
      force: true,
      store
    });

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
