import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId } from '@scipe/jsonld';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { validateOverwriteUpdate, validateOffer } from '../../validators';
import getScopeId from '../../utils/get-scope-id';
import { setEmbeddedIds } from '../../utils/embed-utils';

export default async function handleUpdateServiceAction(
  action,
  service,
  { store, triggered, prevAction }
) {
  const organizationId = getScopeId(service);
  const serviceId = getId(service);

  const messages = validateOverwriteUpdate(
    service,
    action.object,
    action.targetCollection.hasSelector,
    {
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'serviceStatus', // user needs to use Activate or DeactiveAction to change `serviceStatus`
        'serviceOutput',
        'broker',
        'potentialAction',
        'dateCreated'
      ]
    }
  );

  // some changes are restricted to admins
  const nextService = handleOverwriteUpdate(
    service,
    action.object,
    action.targetCollection.hasSelector
  );

  messages.push(...validateOffer(nextService.offers));

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  if (nextService.allowBroker !== service.allowBroker) {
    const couchDbRoles = await this.getCouchDbRoles(action.agent, {
      store,
      fromCache: true
    });

    if (!couchDbRoles.includes('admin')) {
      throw createError(
        403,
        `${
          action['@type']
        } error: only system admin can set the allowBroker prop`
      );
    }
  }

  if (nextService.allowBroker && getId(nextService.brokeredService)) {
    throw createError(
      403,
      `${
        action['@type']
      } error: services with allowBroker set to true cannot specify a brokeredService property`
    );
  }

  // check that brokered service exists
  if (nextService.brokeredService) {
    let brokeredService;
    try {
      brokeredService = await this.get(nextService.brokeredService, {
        acl: false,
        store
      });
    } catch (err) {
      if (err.code !== 404) {
        throw err;
      }
      throw createError(
        400,
        `${
          action['@type']
        } error: invalid brokeredService prop (broker service ${getId(
          nextService.brokeredService
        )} cannot be found)}`
      );
    }

    if (!brokeredService.allowBroker) {
      throw createError(
        403,
        `${action['@type']} error: service ${getId(
          brokeredService
        )} cannot be brokered`
      );
    }

    if (getId(brokeredService.provider) !== getId(nextService.provider)) {
      throw createError(
        400,
        `${
          action['@type']
        } error: invalid value for provider prop, it should be equal to the brokered service provider ${getId(
          brokeredService.provider
        )} (got ${getId(nextService.provider)})`
      );
    }

    // when a service is brokered, availableChannel cannot be set
    if (nextService.availableChannel) {
      throw createError(
        400,
        `${
          action['@type']
        } error: when a service is brokered availableChannet cannot be set `
      );
    }
  } else {
    // `provider` must be equal to objectId (`broker` cannot be changed)
    if (getId(nextService.provider) !== organizationId) {
      throw createError(
        400,
        `${action['@type']} error: provider must be set to ${organizationId}`
      );
    }
  }

  const scope = await this.get(organizationId, {
    acl: false,
    store
  });

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedService = await this.update(
        service,
        service => {
          return setEmbeddedIds(
            handleOverwriteUpdate(
              service,
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
              result: pick(savedService, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          scope
        ),
        createId('action', action, organizationId)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, { result: savedService });
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
        createId('action', action, organizationId)
      );

      return this.put(handledAction, {
        force: true,
        store
      });
    }
  }
}
