import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import {
  validateOverwriteUpdate,
  validateStylesAndAssets
} from '../../validators';
import { setEmbeddedIds } from '../../utils/embed-utils.js';

/**
 * Only `style` or assets can be edited
 */
export default async function handleUpdateReleaseAction(
  action,
  release,
  { store, triggered, prevAction, strict }
) {
  const messages = validateOverwriteUpdate(
    release,
    action.object,
    action.targetCollection.hasSelector,
    {
      arrayProps: ['logo', 'image', 'audio', 'video'],
      immutableProps: Object.keys(release).filter(
        key =>
          key !== 'logo' &&
          key !== 'audio' &&
          key !== 'video' &&
          key !== 'image' &&
          key !== 'style'
      )
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  action = await this.validateAndSetupNodeIds(action, {
    store,
    strict,
    prevEmbedderDoc: release
  });

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedRelease = await this.update(
        release,
        release => {
          const updatedRelease = setEmbeddedIds(
            handleOverwriteUpdate(
              release,
              action.object,
              action.targetCollection.hasSelector
            )
          );

          const messages = validateStylesAndAssets(updatedRelease);
          if (messages.length) {
            throw createError(400, messages.join(' ; '));
          }

          return updatedRelease;
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
              result: pick(savedRelease, ['@id', '@type', 'version']) // for convenience for changes feed processing
            }
          ),
          savedRelease
        ),
        createId('action', action, savedRelease)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, { result: savedRelease });
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
          release
        ),
        createId('action', action, release)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }
  }
}
