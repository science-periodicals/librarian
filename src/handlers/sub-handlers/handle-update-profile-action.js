import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { validateOverwriteUpdate } from '../../validators';
import { setEmbeddedIds } from '../../utils/embed-utils';

// TODO add support for completed UploadAction as object (see handle-updaate-periodical-action.js)

export default async function handleUpdateProfileAction(
  action,
  profile,
  { store, triggered, prevAction }
) {
  const messages = validateOverwriteUpdate(
    profile,
    action.object,
    action.targetCollection.hasSelector,
    {
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'email',
        'dateCreated',
        'dateModified',
        'contactPoint'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedProfile = await this.update(
        profile,
        profile => {
          return setEmbeddedIds(
            handleOverwriteUpdate(
              profile,
              action.object,
              action.targetCollection.hasSelector
            )
          );
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
              result: pick(savedProfile, ['@id', '@type']) // for convenience for changes feed processing
            }
          )
        ),
        createId('action', action, profile)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, { result: savedProfile });
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
          )
        ),
        createId('action', action, profile)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }
  }
}
