import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../../create-id';
import handleParticipants from '../../utils/handle-participants';
import getScopeId from '../../utils/get-scope-id';
import setId from '../../utils/set-id';

export default async function handleDeactivatePublicationTypeAction(
  action,
  publicationType,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (publicationType.publicationTypeStatus === 'ActivePublicationTypeStatus') {
    const scopeId = getScopeId(publicationType);
    const scope = await this.get(scopeId, {
      store,
      acl: false
    });

    const handledPublicationType = Object.assign({}, publicationType, {
      publicationTypeStatus: 'DeactivatedPublicationTypeStatus'
    });

    const handledAction = setId(
      handleParticipants(
        Object.assign(
          {
            startTime: new Date().toISOString()
          },
          action,
          {
            endTime: new Date().toISOString(),
            result: getId(handledPublicationType)
          }
        ),
        scope
      ),
      createId('action', action, scope)
    );

    const [savedAction, savedPublicationType] = await this.put(
      [handledAction, handledPublicationType],
      { store, force: true }
    );

    return Object.assign({}, savedAction, {
      result: savedPublicationType
    });
  }

  // no op
  return action;
}
