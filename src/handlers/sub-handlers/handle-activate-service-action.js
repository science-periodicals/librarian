import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../../create-id';
import handleParticipants from '../../utils/handle-participants';
import getScopeId from '../../utils/get-scope-id';
import setId from '../../utils/set-id';

export default async function handleActivateServiceAction(
  action,
  service,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (
    service.serviceStatus == null ||
    service.serviceStatus === 'DeactivatedServiceStatus'
  ) {
    const handledService = Object.assign({}, service, {
      serviceStatus: 'ActiveServiceStatus'
    });

    const scopeId = getScopeId(service);
    const scope = await this.get(scopeId, {
      store,
      acl: false
    });

    const handledAction = setId(
      handleParticipants(
        Object.assign(
          {
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          action,
          {
            result: getId(handledService)
          }
        ),
        scope
      ),
      createId('action', action, scope)
    );

    const [savedActivateAction, savedService] = await this.put(
      [handledAction, handledService],
      { store, force: true }
    );

    return Object.assign({}, savedActivateAction, {
      result: savedService
    });
  }

  // no op
  return action;
}
