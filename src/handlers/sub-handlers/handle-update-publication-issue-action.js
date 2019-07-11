import moment from 'moment';
import pick from 'lodash/pick';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import {
  validateOverwriteUpdate,
  validateStylesAndAssets
} from '../../validators';
import { createLatestPublicationIssueLockId } from '../../utils/lock-utils';
import { setEmbeddedIds } from '../../utils/embed-utils';

/**
 * Note: special case for latest issue: in this case (and that case only) we can
 * mutate the end of `temporalCoverage` so that the issue span is extended. That
 * triggers a mutation of datePublished
 */
export default async function handleUpdatePublicationIssueAction(
  action,
  issue,
  { store, triggered, prevAction, strict }
) {
  const [scopeId, type, flag] = parseIndexableString(issue._id);
  const isLatest = flag === 'latest';

  // scope is periodical for issues
  const scope = await this.get(scopeId, {
    store,
    acl: false
  });

  action = await this.validateAndSetupNodeIds(action, {
    store,
    strict,
    prevEmbedderDoc: issue
  });

  const messages = validateOverwriteUpdate(
    issue,
    action.object,
    action.targetCollection.hasSelector,
    {
      arrayProps: ['workFeatured', 'logo', 'image', 'audio', 'video'],
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'url',
        'potentialAction',
        'dateCreated',
        'dateModified',
        'creator',
        'author',
        'reviewer',
        'contributor',
        'editor',
        'producer',
        'hasDigitalDocumentPermission',
        'mainEntityOfPage',
        'temporalCoverage' // we don't let user mutate temporal coverage, just datePublished (and only for the latest issue)
      ].concat(isLatest ? [] : 'datePublished')
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  const updatePayload = action.object; // !we do _not_ unrole as the update payload can be anything

  // more validation
  const updatedProps =
    action.targetCollection &&
    action.targetCollection.hasSelector &&
    action.targetCollection.hasSelector.selectedProperty
      ? [action.targetCollection.hasSelector.selectedProperty]
      : Object.keys(updatePayload);

  // datePublished must be after begining of `temporalCoverage`
  if (updatedProps.includes('datePublished')) {
    const [starts] = issue.temporalCoverage.split('/', 2);
    const datePublished =
      action.targetCollection &&
      action.targetCollection.hasSelector &&
      action.targetCollection.hasSelector.selectedProperty
        ? updatePayload
        : updatePayload.datePublished;
    if (moment(datePublished).isBefore(starts)) {
      throw createError(
        400,
        `Invalid datePublished. datePublished must be after ${starts}`
      );
    }
  }

  // TODO more validation:
  // - for workFeatured we ensure that the release exists and that their @id is ?version=latest

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      let lock;
      if (isLatest) {
        // Be sure that the lock is the same as for createPublicationIssue handler
        try {
          lock = await this.createLock(
            createLatestPublicationIssueLockId(scopeId),
            { prefix: 'issue', isLocked: null }
          );
        } catch (err) {
          throw createError(
            423,
            'latest issue is already being processed, try again later'
          );
        }
      }

      let savedAction, savedIssue;
      // top level try for the lock
      try {
        savedIssue = await this.update(
          issue,
          issue => {
            const updatedIssue = setEmbeddedIds(
              handleOverwriteUpdate(
                issue,
                updatePayload,
                action.targetCollection.hasSelector
              )
            );

            updatedIssue.dateModified = new Date().toISOString();

            if (
              isLatest &&
              updatedProps.includes('datePublished') &&
              updatedIssue.temporalCoverage
            ) {
              // keep temporalCoverage in sync
              updatedIssue.temporalCoverage = `${
                updatedIssue.temporalCoverage.split('/', 2)[0]
              }/${updatedIssue.datePublished}`;
            }

            const messages = validateStylesAndAssets(updatedIssue);
            if (messages.length) {
              throw createError(400, messages.join(' ; '));
            }

            return updatedIssue;
          },
          { store, ifMatch: action.ifMatch }
        );

        const handledAction = setId(
          handleParticipants(
            Object.assign(
              {
                endTime: new Date().toISOString()
              },
              action,
              {
                result: pick(savedIssue, ['@id', '@type']) // for convenience for changes feed processing
              }
            ),
            scope
          ),
          createId('action', action, scope)
        );

        savedAction = await this.put(handledAction, {
          store,
          force: true
        });

        if (updatedProps.includes('datePublished')) {
          try {
            await this.syncIssue(savedIssue, { store });
          } catch (err) {
            this.log.error(
              { err, action: savedAction, issue: savedIssue },
              'error syncing issue'
            );
          }
        }
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

      return Object.assign({}, savedAction, { result: savedIssue });
    }

    default: {
      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {},
            action.actionStatus !== 'PotentialActionStatus'
              ? {
                  startTime: new Date().toISOString()
                }
              : undefined,
            action.actionStatus === 'StagedActionStatus'
              ? { stagedTime: new Date().toISOString() }
              : undefined,
            action.actionStatus === 'FailedActionStatus'
              ? {
                  endTime: new Date().toISOString()
                }
              : undefined,
            action
          ),
          scope
        ),
        createId('action', action, scope)
      );

      return this.put(handledAction, {
        store,
        force: true
      });
    }
  }
}
