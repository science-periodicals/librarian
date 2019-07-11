import isPlainObject from 'lodash/isPlainObject';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';
import {
  validateOffer,
  validateDateTimeDuration,
  validateStylesAndAssets
} from '../validators';
import setId from '../utils/set-id';
import { getObjectId } from '../utils/schema-utils';
import { setEmbeddedIds } from '../utils/embed-utils';

// TODO generalize to more than `typesetting` serviceType
// TODO similar handler for CreateOfferAction
/**
 * - resulting service must define a service action in `serviceOutput`
 * - offers must be unique and a potential BuyAction will be added
 */
export default async function handleCreateServiceAction(
  action,
  { store } = {}
) {
  const objectId = getObjectId(action);

  let service = action.result;
  const messages = [];

  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (!objectId) {
    messages.push(
      'Invalid "object" property. "object" must points to an organization @id'
    );
  }

  if (!service) {
    messages.push('Missing "result" property.');
  } else {
    // we force a serviceType (right now limitted to typesetting)
    if (!service.serviceType || service.serviceType !== 'typesetting') {
      messages.push(
        `Invalid "serviceType" property, values are currently restricted to "typesetting".`
      );
    }

    // TODO force audienceScope to be set and equal to the org (objectId)
    // _unless_ user is admin (See allow broker further down for logic on how to
    // detect if user is admin)
    // Service can be restricted to a given organization by specifying an audienceScope prop.
    // e.g.
    // {
    //   '@type': 'Service',
    //   audience: {
    //     '@type': 'Audience',
    //     audienceType: 'author',
    //     audienceScope: 'org:orgId' // must be the same org as `objectId`
    //   }
    // }
    // Note `objectId` will be validated later
    if (
      service.audience &&
      service.audience.audienceScope &&
      getId(service.audience.audienceScope) !== objectId
    ) {
      messages.push(
        `Invalid "audience.audienceScope" property, when specified "audienceScope" must points to ${objectId}`
      );
    }

    // Do not allow user to specify `serviceOutput`
    if (service.serviceOutput) {
      messages.push('"serviceOutput" property cannot be set');
    }

    // validate `offers`
    // e.g.
    // offers: {
    //   '@id': 'node:typesetting',
    //   '@type': 'Offer',
    //   priceSpecification: {
    //     '@type': 'UnitPriceSpecification',
    //     price: 50,
    //     priceCurrency: 'USD',
    //     unitText: 'submission',
    //     valueAddedTaxIncluded: false,
    //     platformFeesIncluded: false
    //   },
    // addOn is available once the offer is purchased
    // that's how we allow free revisions for typesetting
    //   addOn: {
    //    '@type': 'Offer',
    //     priceSpecification: {},
    //     eligibleCustomerType: 'RevisionAuthor',
    //     ...
    //   }
    // }
    if (!isPlainObject(service.offers)) {
      messages.push(
        'Service must have one offer (specified in the offers property)'
      );
    } else {
      messages.push(...validateOffer(service.offers));
    }

    // Validate `provider`, `broker`, `brokeredService` and `allowBroker`
    if (service.allowBroker) {
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

      if (getId(service.brokeredService)) {
        throw createError(
          403,
          `${
            action['@type']
          } error: services with allowBroker set to true cannot specify a brokeredService property`
        );
      }
    }

    if (service.brokeredService) {
      let brokeredService;
      try {
        brokeredService = await this.get(service.brokeredService, {
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
            service.brokeredService
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

      if (getId(brokeredService.provider) !== getId(service.provider)) {
        throw createError(
          400,
          `${
            action['@type']
          } error: invalid value for provider prop, it should be equal to the brokered service provider ${getId(
            brokeredService.provider
          )} (got ${getId(service.provider)})`
        );
      }

      // when a service is brokered, availableChannel cannot be set
      if (service.availableChannel) {
        throw createError(
          400,
          `${
            action['@type']
          } error: when a service is brokered availableChannet cannot be set `
        );
      }
    } else {
      // if set, `broker` and `provider` must be equal to objectId
      ['provider', 'broker'].forEach(p => {
        if (getId(service[p]) && getId(service[p]) !== objectId) {
          throw createError(
            400,
            `${
              action['@type']
            } error: when specified, ${p} must be set to ${objectId} (got ${getId(
              service[p]
            )})`
          );
        }
      });
    }

    // Validate `availableChannel`
    // e.g.
    // availableChannel: {
    //   '@type': 'ServiceChannel',
    //   'processingTime': 'P2D'
    // }
    if (service.availableChannel && service.availableChannel.processingTime) {
      messages.push.apply(
        messages,
        validateDateTimeDuration(service.availableChannel)
      );
    }
  }

  messages.push.apply(messages, validateStylesAndAssets(service));

  if (messages.length) {
    throw createError(400, `Invalid ${action['@type']}. ${messages.join(' ')}`);
  }

  const organization = await this.get(objectId, {
    acl: false,
    store
  });

  if (!organization || organization['@type'] !== 'Organization') {
    throw createError(
      400,
      `Invalid "object" property. "object" ${objectId} must points to an existing Organization`
    );
  }

  const handledService = setEmbeddedIds(
    setId(
      Object.assign(
        {
          '@type': 'Service',
          serviceStatus: 'DeactivatedServiceStatus',
          // provide a default audience if none was specified
          audience: {
            '@type': 'Audience',
            audienceType: 'user'
          },
          // currently we limit service to typesetting
          serviceType: 'typesetting'
        },
        service,
        // overwrite:
        {
          // we makes sure that both `provider` and `broker` are defined
          provider: getId(service.provider) || getId(organization),
          broker: getId(organization),
          // offers so that they have an @id and potential action
          offers: setId(
            Object.assign(
              { '@type': 'Offer' },
              service.offers,
              {
                valueAddedTaxIncluded: false,
                platformFeesIncluded: false,
                potentialAction: {
                  '@id': createId('blank')['@id'],
                  '@type': 'BuyAction'
                }
              },
              service.offers && service.offers.addOn
                ? {
                    addOn: dearrayify(
                      service.offers.addOn,
                      arrayify(service.offers.addOn).map(offer =>
                        setId(
                          Object.assign({ '@type': 'Offer' }, offer, {
                            valueAddedTaxIncluded: false,
                            platformFeesIncluded: false,
                            potentialAction: {
                              '@id': createId('blank')['@id'],
                              '@type': 'BuyAction'
                            }
                          }),
                          createId('node', getId(offer), getId(organization))
                        )
                      )
                    )
                  }
                : undefined
            ),
            createId('node', getId(service.offers), getId(organization))
          )
        },

        service.brokeredService
          ? { brokeredService: getId(service.brokeredService) }
          : undefined,

        // serviceOutput so that it has an @id
        service.serviceType === 'typesetting'
          ? {
              serviceOutput: setId(
                {
                  '@type': 'TypesettingAction',
                  actionStatus: 'ActiveActionStatus',
                  name: 'Typeset Document',
                  agent: {
                    '@type': getId(service.brokeredService)
                      ? 'ServiceProviderRole'
                      : 'ContributorRole',
                    roleName: 'producer',
                    name: 'typesetter'
                  },
                  // we ensure that producers and authors are listed in the audience
                  participant: [
                    {
                      '@type': 'Audience',
                      audienceType: 'producer'
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'author'
                    }
                  ],
                  object: {
                    '@type': 'DocumentObject'
                  }
                },
                createId('blank')['@id']
              )
            }
          : undefined,

        createId('service', getId(service), getId(organization))
      )
    )
  );

  const handledAction = setId(
    Object.assign({ startTime: new Date().toISOString() }, action, {
      result: getId(handledService),
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString()
    }),
    createId('action', getId(action), getId(organization))
  );

  const [savedAction, savedService] = await this.put(
    [handledAction, handledService],
    {
      store,
      force: true
    }
  );

  return Object.assign(savedAction, { result: savedService });
}
