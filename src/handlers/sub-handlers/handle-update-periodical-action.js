import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import {
  validateOverwriteUpdate,
  validateStylesAndAssets,
  validateJournalComments
} from '../../validators';
import { setEmbeddedIds } from '../../utils/embed-utils';

export default async function handleUpdatePeriodicalAction(
  action,
  periodical,
  { store, triggered, prevAction, strict }
) {
  const messages = validateOverwriteUpdate(
    periodical,
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
        'datePublished',
        'dateCreated',
        'dateModified',
        'creator',
        'author',
        'reviewer',
        'contributor',
        'editor',
        'producer',
        'hasDigitalDocumentPermission',
        'mainEntityOfPage'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  action = await this.validateAndSetupNodeIds(action, {
    store,
    strict,
    prevEmbedderDoc: periodical
  });

  const updatePayload = action.object; // !we do _not_ unrole as the update payload can be anything

  // TODO more validation:
  // - for workFeatured we ensure that the release exists and that their @id is ?version=latest

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedPeriodical = await this.update(
        periodical,
        periodical => {
          let updatedPeriodical = handleOverwriteUpdate(
            periodical,
            updatePayload,
            action.targetCollection.hasSelector
          );
          updatedPeriodical = setEmbeddedIds(updatedPeriodical);
          updatedPeriodical.dateModified = new Date().toISOString();

          const messages = validateStylesAndAssets(updatedPeriodical).concat(
            validateJournalComments(updatedPeriodical)
          );
          if (messages.length) {
            throw createError(400, messages.join(' ; '));
          }

          return updatedPeriodical;
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
              result: pick(savedPeriodical, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          savedPeriodical
        ),
        createId('action', action, savedPeriodical)
      );

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      return Object.assign({}, savedAction, { result: savedPeriodical });
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
          periodical
        ),
        createId('action', action, periodical)
      );

      return this.put(handledAction, {
        store,
        force: true
      });
    }
  }
}
