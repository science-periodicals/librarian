import pick from 'lodash/pick';
import isPlainObject from 'lodash/isPlainObject';
import { getId, unrole, unprefix } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { normalizePermissions } from '../acl';
import createId from '../create-id';
import {
  validateDigitalDocumentPermission,
  validateDateTimeDuration,
  validateStylesAndAssets,
  validateJournalComments
} from '../validators';
import handleParticipants from '../utils/handle-participants';
import setId from '../utils/set-id';
import validateAndSetupCreatedCreativeWorkRoles from '../utils/validate-and-setup-created-creative-work-roles';
import { getAgentId, getObjectId } from '../utils/schema-utils';
import { setEmbeddedIds } from '../utils/embed-utils';

export default async function handleCreatePeriodicalAction(
  action,
  { store, triggered, prevAction, strict = true } = {}
) {
  // validation
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const agentId = getAgentId(action.agent);
  if (!agentId) {
    throw createError(400, 'CreatePeriodicalAction must have a valid agent');
  }

  // Note: acl already validated that the org is valid and that the agent is an org admin
  const orgId = getObjectId(action);
  if (!orgId) {
    throw createError(
      400,
      'CreatePeriodicalAction must have a valid object pointing to an Organization'
    );
  }

  let periodical = unrole(action.result, 'result');
  const periodicalId = getId(periodical);
  const reservedIds = new Set(['www', 'ns', 'reset-password', 'nightly']);
  if (
    !periodicalId ||
    reservedIds.has(unprefix(periodicalId)) ||
    periodicalId !== createId('journal', periodical)['@id']
  ) {
    throw createError(
      400,
      'CreatePeriodicalAction result must have a valid @id'
    );
  }

  if (!isPlainObject(periodical)) {
    periodical = { '@id': periodicalId };
  }

  const forbiddenProps = [
    'mainEntityOfPage',
    'url',
    'potentialWorkflow',
    'publicationTypeCoverage',
    'potentialAction'
  ].filter(p => p in periodical);

  if (forbiddenProps.length) {
    throw createError(
      400,
      `CreatePeriodicalAction cannot be used to set the following properties: ${forbiddenProps.join(
        ','
      )}. Use the dedicated actions instead after creating the periodical`
    );
  }

  if (periodical.hasDigitalDocumentPermission) {
    try {
      validateDigitalDocumentPermission(
        periodical.hasDigitalDocumentPermission,
        { validGranteeIds: new Set([agentId]) }
      );
    } catch (err) {
      throw err;
    }
  }

  periodical = setEmbeddedIds(
    setId(
      Object.assign(
        // Defaults. Note: we let user set dateCreated for journal import purposes
        {
          dateCreated: new Date().toISOString()
        },
        periodical,
        {
          '@type': 'Periodical',
          creator: agentId,
          url: `https://${unprefix(periodicalId)}.sci.pe`,
          publisher: orgId
        }
      ),
      createId('journal', periodicalId)
    )
  );

  // we get the user profile so we can handle the contact points
  const profile = await this.get(agentId, {
    acl: false
  });

  periodical = validateAndSetupCreatedCreativeWorkRoles(periodical, {
    strict,
    agent: action.agent,
    agentProfile: profile
  });

  // normalize permissions (need to be done after role renormalization)
  if (periodical.hasDigitalDocumentPermission) {
    periodical = normalizePermissions(periodical);
  }

  const messages = validateDateTimeDuration(periodical).concat(
    validateStylesAndAssets(periodical),
    validateJournalComments(periodical)
  );
  if (messages.length) {
    throw createError(400, messages.join(' ; '));
  }

  periodical = await this.validateAndSetupNodeIds(periodical, {
    store,
    strict
  });

  const handledCreatePeriodicalAction = Object.assign(
    {
      startTime: new Date().toISOString()
    },
    handleParticipants(action, periodical),
    {
      endTime: new Date().toISOString(),
      actionStatus: 'CompletedActionStatus',
      result: pick(periodical, ['@id', '@type', 'url'])
    },
    createId('action', action['@id'], periodical['@id'])
  );

  const lock = await this.createLock(getId(periodical), {
    prefix: 'create-periodical',
    isLocked: async () => {
      const hasUniqId = await this.hasUniqId(getId(periodical));

      let prevPeriodical;
      try {
        prevPeriodical = await this.get(getId(periodical), { store });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }

      return hasUniqId || !!prevPeriodical;
    }
  });

  let savedCreatePeriodicalAction, savedPeriodical;
  try {
    [savedCreatePeriodicalAction, savedPeriodical] = await this.put(
      [handledCreatePeriodicalAction, periodical],
      { force: true, store }
    );
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

  return Object.assign(savedCreatePeriodicalAction, {
    result: savedPeriodical
  });
}
