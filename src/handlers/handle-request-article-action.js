import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, unprefix } from '@scipe/jsonld';
import setId from '../utils/set-id';
import createId from '../create-id';
import { getObjectId } from '../utils/schema-utils';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import { parseRoleIds } from '../utils/role-utils';
import { validateImmutableProps } from '../validators';
import handleParticipants from '../utils/handle-participants';
import { addPublicAudience } from '../utils/workflow-utils';

/**
 * Journals can issue Request for Articles (RFAs)
 */
export default async function handleRequestArticleAction(
  action,
  { store, triggered, prevAction } = {}
) {
  // validation
  const objectId = getObjectId(action);
  if (!objectId || !objectId.startsWith('journal:')) {
    throw createError(400, `${action['@type']} object must be a journal @id`);
  }

  const journal = await this.get(objectId, { acl: false, store });

  let sourceAgent;
  const role = findRole(action.agent, journal, {
    ignoreEndDateOnPublicationOrRejection: true
  });
  if (!role) {
    const { userId } = parseRoleIds(role);
    if (userId) {
      sourceAgent = userId;
    } else {
      throw createError(
        400,
        `${action['@type']} agent must be listed in the journal ${getId(
          journal
        )} or have a valid userId`
      );
    }
  } else {
    sourceAgent = remapRole(role, 'agent', { dates: false });
  }

  const immutableProps = ['startTime', 'url'];
  const messages = validateImmutableProps(immutableProps, action, prevAction);
  if (messages.length) {
    throw createError(400, `${action['@type']}: ${messages.join('; ')}`);
  }
  // backport immutable values
  if (prevAction) {
    action = Object.assign({}, action, pick(prevAction, immutableProps));
  }

  let handledAction;
  const now = new Date().toISOString();
  // we generate a "pretty" @id if the user didn't specify one
  const prettyId = getId(action)
    ? getId(action)
    : `${unprefix(getId(journal))}-${new Date().getTime()}}`;
  const rfaId = createId('action', prettyId, getId(journal));
  const rfaUrl = `${journal.url}/rfas/${unprefix(getId(rfaId))}`;

  let lock;
  if (!prevAction) {
    lock = await this.createLock(getId(rfaId), {
      prefix: 'rfa',
      isLocked: async () => {
        const hasUniqId = await this.hasUniqId(getId(rfaId));

        let prevRfa;
        try {
          prevRfa = await this.get(getId(rfaId), { store });
        } catch (err) {
          if (err.code !== 404) {
            throw err;
          }
        }

        return hasUniqId || !!prevRfa;
      }
    });
  }

  switch (action.actionStatus) {
    case 'PotentialActionStatus':
    case 'ActiveActionStatus':
      handledAction = setId(
        handleParticipants(
          // we add public audience mostly for the librarian.search
          addPublicAudience(
            Object.assign(
              {
                startTime: now,
                url: rfaUrl
              },
              action,
              {
                agent: sourceAgent,
                object: objectId
              }
            ),
            { now }
          ),
          journal
        ),
        rfaId
      );
      break;

    case 'CompletedActionStatus':
      handledAction = setId(
        handleParticipants(
          addPublicAudience(
            Object.assign({ startTime: now, url: rfaUrl }, action, {
              agent: sourceAgent,
              object: objectId,
              endTime: new Date().toISOString()
            }),
            { now }
          ),
          journal
        ),
        rfaId
      );
      break;

    default:
      throw createError(
        400,
        `${
          action['@type']
        } actionStatus must be PotentialActionStatus, ActiveActionStatus or CompletedActionStatus`
      );
  }

  let savedAction;

  try {
    savedAction = await this.put(handledAction, {
      store,
      force: true
    });
  } catch (err) {
    throw err;
  } finally {
    if (lock) {
      try {
        await lock.unlock();
      } catch (err) {
        this.log.error(
          { err },
          'could not release lock, but it will auto expire'
        );
      }
    }
  }

  return savedAction;
}
