import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import createId from '../../create-id';
import handleParticipants from '../../utils/handle-participants';
import getScopeId from '../../utils/get-scope-id';
import setId from '../../utils/set-id';

export default async function handleDeactivateServiceAction(
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

  if (service.serviceStatus === 'ActiveServiceStatus') {
    const handledService = Object.assign({}, service, {
      serviceStatus: 'DeactivatedServiceStatus'
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
            startTime: new Date().toISOString()
          },
          action,
          {
            endTime: new Date().toISOString(),
            result: getId(handledService)
          }
        ),
        scope
      ),
      createId('action', action, scope)
    );

    const [savedDeactivateAction, savedService] = await this.put(
      [handledAction, handledService],
      { strict: false, store }
    );

    return Object.assign({}, savedDeactivateAction, {
      result: savedService
    });
  }

  // no op
  return action;
}
