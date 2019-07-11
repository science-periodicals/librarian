import pickBy from 'lodash/pickBy';
import omit from 'lodash/omit';
import {
  getId,
  arrayify,
  reUuid,
  unprefix,
  dearrayify,
  getNodeMap
} from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../../create-id';
import { getObjectId, getAgentId, getResultId } from '../../utils/schema-utils';
import handleParticipants from '../../utils/handle-participants';
import { getStageActions } from '../../utils/workflow-utils';
import getScopeId from '../../utils/get-scope-id';
import setId from '../../utils/set-id';
import findRole from '../../utils/find-role';
import remapRole from '../../utils/remap-role';
import getActiveRoles from '../../utils/get-active-roles';
import { PDF } from '../../constants';

/**
 * Instantiate a "TypesettingAction"
 *
 * - object is an Offer
 * - result is an Order
 * - instrumentOf must be specified and point to an _active_ `workflowAction`
 * (part of workflow stage) listing a service (in `potentialService`) whose offer
 * is compatible with the purchased one (`object`)
 *
 * Note: the instantiated "service action" points to the Service through the `serviceOutputOf` pointer
 *
 * See also: PayAction for APC
 */
export default async function handleBuyTypesettingAction(
  action,
  service,
  { store, triggered, skipPayments } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const offerId = getObjectId(action);
  if (!offerId) {
    throw createError(400, 'BuyAction need a valid object (Offer).');
  }

  const offer = arrayify(service.offers)
    .concat(arrayify(service.offers.addOn))
    .find(offer => getId(offer) === offerId);

  const buyActionTemplate = arrayify(offer.potentialAction).find(
    template => template['@type'] === 'BuyAction'
  );
  if (!buyActionTemplate) {
    throw createError(
      400,
      `Could not find potential BuyAction for offer ${offerId} of service ${getId(
        service
      )}.`
    );
  }

  const typesettingActionTemplate = service.serviceOutput;

  let workflowAction;
  try {
    workflowAction = await this.get(getId(action.instrumentOf), {
      store,
      acl: false
    });
  } catch (err) {
    if (err.code === 404) {
      throw createError(
        400,
        'BuyAction needs to specify a workflow action through the instrumentOf property'
      );
    } else {
      throw err;
    }
  }

  // validate that workflow action is active, list the service as potential service and is part of a workflow
  if (
    workflowAction.actionStatus !== 'ActiveActionStatus' ||
    !getId(workflowAction.resultOf) ||
    !arrayify(workflowAction.potentialService).some(
      potentialService => getId(potentialService) === getId(service)
    )
  ) {
    throw createError(
      400,
      'BuyAction needs to specify an active workflow action listing the service offering the purchased service as potential service through the instrumentOf property'
    );
  }

  // we lock so that only 1 TS action can be purchased per active `workflowAction` (CreateReleaseAction)
  // we guarantee that all data are available first so that the `getActionsByInstrumentOfId` view is reliable
  await this.ensureAllWorkflowActionsStateMachineStatus(
    getScopeId(workflowAction),
    { store }
  );

  const lock = await this.createLock(getId(workflowAction), {
    isLocked: async () => {
      let instances;

      try {
        // Note this view is safe given that we prefetched all the workflow action upstream
        instances = await this.getActionsByInstrumentOfId(
          getId(workflowAction),
          { store }
        );
      } catch (err) {
        if (err.code === 404) {
          return false;
        }
        throw err;
      }

      return (
        instances &&
        instances.some(action =>
          arrayify(action.potentialService).some(
            _service => getId(service) === getId(_service) // Note: there can be UpdateAction with the same `instrumentOf` as the CRA so we explicitly check the `potentialService`
          )
        )
      );
    },
    prefix: 'buy-typesetting-service'
  });

  try {
    const scopeId = getScopeId(workflowAction);

    if (offer.eligibleCustomerType === 'RevisionAuthor') {
      // validate that a previous offer was previously purchased

      const prevInstances = await this.getActionsByTemplateIdsAndScopeId(
        getId(typesettingActionTemplate),
        scopeId,
        { store }
      );
      if (!prevInstances.length) {
        throw createError(
          400,
          `${action['@type']}: customer is not eligible for offer ${getId(
            offer
          )} (require a customer type of ${offer.eligibleCustomerType})`
        );
      }
    }

    const graphId = createId('graph', scopeId)['@id'];
    let graph = await this.get(graphId, {
      store,
      acl: false
    });

    // find the encoding
    const nodeMap = getNodeMap(graph);
    const mainEntity = nodeMap[getId(graph.mainEntity)];
    if (!mainEntity) {
      throw createError(
        400,
        `BuyAction: graph (${getId(graph)}) doesn't have a mainEntity`
      );
    }

    const encoding = arrayify(mainEntity.encoding)
      .map(encodingId => nodeMap[getId(encodingId)])
      .find(encoding => encoding && encoding.fileFormat === PDF);
    if (!encoding) {
      throw createError(
        400,
        `BuyAction: could not find a PDF ($[PDF}) encoding associated with the graph (${getId(
          graph
        )})`
      );
    }
    // re-embedd the contentChecksum as it is needed for the app-suite (typesetter revision request use the `ifMatch` prop pointing to the encoding sha)
    if (encoding.contentChecksum) {
      encoding.contentChecksum = dearrayify(
        encoding.contentChecksum,
        arrayify(encoding.contentChecksum).map(contentChecksumId => {
          const contentChecksum = nodeMap[getId(contentChecksumId)];
          return contentChecksum || contentChecksumId;
        })
      );
    }

    const { price } = offer.priceSpecification;
    if (price > 0) {
      // validate that action has a PaymentToken
      if (
        !action.paymentToken ||
        typeof action.paymentToken.value !== 'string'
      ) {
        throw createError(
          400,
          `${
            action['@type']
          } must have a valid paymentToken (object with a defined value property set to a valid stripe source)`
        );
      }
    }

    const sourceAgent = findRole(action.agent, graph, {
      ignoreEndDateOnPublicationOrRejection: true
    });
    if (!sourceAgent) {
      throw createError(
        400,
        'Invalid agent, agent could not be found in the Graph'
      );
    }

    // We let the user set the typesettingAction @id by setting the @id
    // of the `orderedItem` to an action:<uuid> (this is mostly useful for stories)
    let orderedItemId = getId(action.result && action.result.orderedItem);
    if (
      !orderedItemId ||
      !orderedItemId.startsWith('action:') ||
      !reUuid.test(unprefix(orderedItemId))
    ) {
      orderedItemId = undefined;
    }

    // if the typesettingActionTemplate has an agent of @type `ServiceProviderRole` (so if it is a proxied service), we need to:
    // - pick the relevant `agent` from the Organization (he can be specified in the `action` participant)
    // - assign the instantiated typesettingAction
    // - add the assignee (`agent`) to the `graph`
    let typesetter;
    if (typesettingActionTemplate.agent['@type'] === 'ServiceProviderRole') {
      const org = await this.get(getId(service.provider), {
        store,
        acl: false
      });

      // Typesetter can be specified as participant of the buy action
      if (action.participant) {
        const participant = arrayify(action.participant).find(
          participant =>
            !!findRole(participant, org, {
              ignoreEndDateOnPublicationOrRejection: true
            })
        );

        if (participant) {
          const role = findRole(participant, org, {
            ignoreEndDateOnPublicationOrRejection: true
          });

          // for stories, user can specify the future graph role id as `sameAs` of the particiapnt
          let roleId;
          const sameAsId = getId(participant.sameAs);
          if (
            sameAsId &&
            (sameAsId.startsWith('role:') || sameAsId.startsWith('_:')) &&
            reUuid.test(unprefix(sameAsId))
          ) {
            roleId = sameAsId;
          }

          typesetter = setId(
            remapRole(role, 'agent', { dates: false }),
            createId('role', roleId)
          );
        }
      }

      if (!typesetter) {
        // we allocate the first compatible role from the org or we error
        const roles = getActiveRoles(org);
        const role = roles.find(
          role =>
            role.roleName === typesettingActionTemplate.agent.roleName &&
            role.name == typesettingActionTemplate.agent.name &&
            role['@type'] === typesettingActionTemplate.agent['@type']
        );

        if (!role) {
          throw createError(
            400,
            `${
              action['@type']
            }: no member compatible with the typesetting action template can be found in ${
              org['@type']
            } ${getId(org)}`
          );
        }

        typesetter = setId(
          remapRole(role, 'agent', { dates: false }),
          createId('role', null)
        );
      }

      // Force add the typesetter to the graph
      // we do it before completing the BuyAction so that it can be retried
      if (typesetter) {
        const addedRole = Object.assign(
          {},
          remapRole(typesetter, 'producer', {
            dates: false
          }),
          {
            startDate: new Date().toISOString()
          }
        );

        graph = await this.update(
          graph,
          object => {
            return Object.assign({}, object, {
              producer: arrayify(object.producer).concat(
                findRole(omit(addedRole, ['@id']), object, {
                  ignoreEndDateOnPublicationOrRejection: true
                }) // we omit the @id so that we match similar role
                  ? [] // for whatever reason (for instance a JoinAction) the role was already added => noop
                  : addedRole
              )
            });
          },
          { store }
        );
      }
    }

    let expectedDuration;
    if (getId(service.brokeredService)) {
      const brokeredService = await this.get(getId(service.brokeredService), {
        acl: false,
        store
      });
      expectedDuration =
        brokeredService.availableChannel &&
        brokeredService.availableChannel.processingTime;
    } else {
      expectedDuration =
        service.availableChannel && service.availableChannel.processingTime;
    }

    // We need to compute the `identifier` for the ServiceAction
    const stage = await this.get(getId(workflowAction.resultOf), {
      store,
      acl: false
    });

    const identifiedStageActions = getStageActions(stage).filter(
      action => action.identifier != null && action['@type'] !== 'EndorseAction'
    );

    // Instantiate the ServiceAction
    const typesettingAction = setId(
      handleParticipants(
        pickBy(
          Object.assign(
            {},
            omit(typesettingActionTemplate, [
              'actionStatus',
              'potentialAction',
              'expectsAcceptanceOf'
            ]),
            {
              actionStatus: 'ActiveActionStatus',
              agent: typesetter || typesettingActionTemplate.agent,
              startTime: new Date().toISOString(),
              targetedRelease: getResultId(workflowAction),
              expectedDuration,
              // TODO Improve: setting the identifier this way is subject to a potential race condition, we should put a lock so that there can only be 1 buy action at a time so that this is safe
              identifier: `${workflowAction.identifier.split('.')[0]}.${
                identifiedStageActions.length
              }`,
              object: encoding,
              serviceOutputOf: getId(service), // pointer needed for the app-suite to quickly filter the "service action"
              instrumentOf: getId(workflowAction), // pointer needed for the app-suite to associate the service action with a workflow action
              resultOf: getId(workflowAction.resultOf), // needed for the actionsByWorkflowStageAndType view
              instanceOf: getId(typesettingActionTemplate),
              // Note: we add the agent of the BuyAction as a customer role this is important as this user can be used to ensure proxy authentication
              participant: arrayify(
                typesettingActionTemplate.participant
              ).concat(
                Object.assign(createId('srole', null, getId(sourceAgent)), {
                  roleName: 'customer',
                  startDate: new Date().toISOString(),
                  participant: getAgentId(sourceAgent)
                })
              )
            }
          ),
          x => x !== undefined
        ),
        graph
      ),
      createId('action', orderedItemId || null, graph)
    );

    const order = {
      '@id': createId('node')['@id'],
      '@type': 'Order',
      customer: getId(sourceAgent),
      seller: getId(service.broker || service.provider),
      orderDate: new Date().toISOString(),
      acceptedOffer: {
        '@id': offerId,
        itemOffered: getId(service) // pointer for notifications
      },
      orderedItem: getId(typesettingAction)
    };

    const handledAction = setId(
      handleParticipants(
        pickBy(
          Object.assign(
            {
              startTime: new Date().toISOString()
            },
            action,
            {
              agent: remapRole(sourceAgent, 'agent'),
              actionStatus: 'CompletedActionStatus',
              endTime: new Date().toISOString(),
              result: order,
              instrumentOf: getId(workflowAction),
              resultOf: getId(workflowAction.resultOf),
              instanceOf: getId(buyActionTemplate)
            }
          ),
          x => x !== undefined
        ),
        graph
      ),
      createId('action', null, graph)
    );

    // need to be called when action is handled but _before_ it is saved or
    // side effects are executed so it can be easily retry if failures
    await this.createCharge(handledAction, { store, skipPayments });
    await this.createUsageRecord(handledAction, { store, skipPayments });
    await this.createInvoiceItem(handledAction, { store, skipPayments });

    const [savedAction, savedTypesettingAction] = await this.put(
      [handledAction, typesettingAction],
      {
        store,
        force: true
      }
    );

    // add back saved service action to the returned value for convenience
    savedAction.result.orderedItem = savedTypesettingAction;

    try {
      await this.syncGraph(graph, [savedAction, savedTypesettingAction], {
        store
      });
    } catch (err) {
      this.log.error(
        {
          err,
          actions: [savedAction, savedTypesettingAction]
        },
        'error syncing graphs'
      );
    }

    // we need to embed the typesettingAction and its potential action for the syncWorkflow method
    const payload = Object.assign({}, savedAction, {
      result: Object.assign({}, savedAction.result, {
        orderedItem: Object.assign({}, savedTypesettingAction)
      })
    });

    try {
      await this.syncWorkflow(payload, { store });
    } catch (err) {
      this.log.error({ err, action: payload }, 'error syncing workflowStage');
    }

    return payload;
  } catch (err) {
    throw err;
  } finally {
    try {
      await lock.unlock();
    } catch (err) {
      this.log.error(
        err,
        'could not unlock release lock, but will auto expire'
      );
    }
  }
}
