import assert from 'assert';
import uuid from 'uuid';
import omit from 'lodash/omit';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  getObjectId,
  SCIPE_EXPLORER_OFFER_ID
} from '../src/';

// TODO test with payment token triggering errors (see https://stripe.com/docs/connect/testing)

describe('Invoices', function() {
  this.timeout(40000);

  let librarian,
    admin,
    user,
    author,
    typesetter,
    serviceProviderOrganization,
    organization,
    periodical,
    subscribeAction,
    defaultCreateGraphAction;

  before(async () => {
    librarian = new Librarian();
    admin = await registerUser({ memberOf: 'acl:admin' });
    user = await registerUser();
    author = await registerUser();
    typesetter = await registerUser();

    const createProviderOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(admin),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'Bogich Inc.'
        }
      },
      { acl: admin }
    );

    serviceProviderOrganization = createProviderOrganizationAction.result;

    // invite typesetter to the provider org
    const inviteAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(serviceProviderOrganization.member)[0]),
        recipient: {
          '@type': 'ServiceProviderRole',
          roleName: 'producer',
          name: 'typesetter',
          recipient: getId(typesetter)
        },
        object: getId(serviceProviderOrganization)
      },
      { acl: admin }
    );

    const acceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(typesetter),
        object: inviteAction['@id']
      },
      { acl: typesetter }
    );
    serviceProviderOrganization = acceptAction.result.result;
    // console.log(require('util').inspect(acceptAction, { depth: null }));

    const createProviderServiceAction = await librarian.post(
      {
        '@type': 'CreateServiceAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(admin),
        object: getId(serviceProviderOrganization),
        result: {
          '@type': 'Service',
          name: 'Smart typesetting',
          serviceType: 'typesetting',
          allowBroker: true,
          availableChannel: {
            '@type': 'ServiceChannel',
            processingTime: 'P1D'
          },
          offers: {
            '@type': 'Offer',
            priceSpecification: {
              '@type': 'PriceSpecification',
              price: 10,
              priceCurrency: 'USD',
              valueAddedTaxIncluded: false,
              platformFeesIncluded: false
            }
          }
        }
      },
      { acl: admin }
    );

    const brokeredService = createProviderServiceAction.result;

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'org'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    subscribeAction = await librarian.post(
      {
        '@type': 'SubscribeAction',
        agent: getId(user),
        actionStatus: 'ActiveActionStatus',
        instrument: getId(organization),
        object: 'service:scipe',
        expectsAcceptanceOf: SCIPE_EXPLORER_OFFER_ID,
        paymentToken: {
          '@type': 'PaymentToken',
          value: 'tok_visa' // see https://stripe.com/docs/testing#cards
        }
      },
      { acl: user }
    );

    const createServiceAction = await librarian.post(
      {
        '@type': 'CreateServiceAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        object: getId(organization),
        result: {
          '@type': 'Service',
          serviceType: 'typesetting',
          provider: getId(serviceProviderOrganization),
          broker: getId(organization),
          brokeredService: getId(brokeredService),
          offers: {
            '@type': 'Offer',
            priceSpecification: {
              '@type': 'PriceSpecification',
              price: 0, // make it 0 so that no charge are created (charges are tested in another test)
              priceCurrency: 'USD',
              valueAddedTaxIncluded: false,
              platformFeesIncluded: false
            }
          }
        }
      },
      { acl: user }
    );

    const service = createServiceAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: getId(user)
          },
          producer: {
            '@type': 'ContributorRole',
            roleName: 'producer',
            producer: getId(user)
          },
          hasDigitalDocumentPermission: [
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'CreateGraphPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'user'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'ReadPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: [
                getId(user),
                { '@type': 'Audience', audienceType: 'editor' },
                { '@type': 'Audience', audienceType: 'producer' }
              ]
            }
          ]
        }
      },
      { acl: user }
    );
    periodical = createPeriodicalAction.result;

    const createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(user),
        object: getId(periodical),
        result: {
          '@type': 'WorkflowSpecification',
          expectedDuration: 'P60D',
          potentialAction: {
            '@type': 'CreateGraphAction',
            agent: { '@type': 'Role', roleName: 'author' },
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'author' },
                  { '@type': 'Audience', audienceType: 'reviewer' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              },
              potentialAction: [
                {
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: [
                    {
                      '@type': 'CreateReleaseAction',
                      actionStatus: 'ActiveActionStatus',
                      agent: {
                        '@type': 'ContributorRole',
                        roleName: 'author'
                      },
                      participant: [
                        {
                          '@type': 'Audience',
                          audienceType: 'author'
                        },
                        {
                          '@type': 'Audience',
                          audienceType: 'editor'
                        }
                      ],
                      potentialService: getId(service),
                      result: {
                        '@type': 'Graph',
                        version: 'preminor',
                        potentialAction: {
                          '@type': 'PublishAction',
                          agent: {
                            '@type': 'ContributorRole',
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      },
      { acl: user }
    );

    const workflowSpecification = createWorkflowSpecificationAction.result;

    defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@id': createId('graph', uuid.v4())['@id'],
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(arrayify(periodical.editor)[0]),
          mainEntity: '_:main',
          '@graph': [
            {
              '@id': '_:main',
              '@type': 'ScholarlyArticle',
              encoding: {
                '@type': 'DocumentObject',
                fileFormat: 'application/pdf',
                contentChecksum: {
                  '@type': 'Checksum',
                  checksumAlgorithm: 'sha256',
                  checksumValue: 'sha'
                }
              }
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    let graph = createGraphAction.result;

    let createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    // author buys TypesettingService
    const offer = service.offers;
    const buyActionTemplate = arrayify(offer.potentialAction)[0];

    const buyAction = await librarian.post(
      Object.assign({}, buyActionTemplate, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        instrumentOf: getId(createReleaseAction),
        object: getId(service.offers)
      }),
      {
        acl: author
      }
    );

    let typesettingAction = buyAction.result.orderedItem;

    // typesetter completes the TS aciton
    const resource = graph['@graph'].find(
      node => node['@type'] === 'ScholarlyArticle'
    );

    const uploadAction = await librarian.put(
      Object.assign(createId('action', null, graph), {
        '@type': 'UploadAction',
        agent: getId(typesetter),
        actionStatus: 'CompletedActionStatus',
        object: {
          '@id': 'node:encodingId',
          encodesCreativeWork: getId(resource),
          isNodeOf: getId(graph)
        },
        result: {
          '@type': 'DocumentObject',
          contentUrl: '/encoding/typesetted.ds3.docx',
          isBasedOn: getObjectId(typesettingAction),
          encodesCreativeWork: getId(resource),
          isNodeOf: getId(graph)
        }
      })
    );

    typesettingAction = await librarian.post(
      Object.assign({}, omit(typesettingAction, ['potentialAction']), {
        agent: Object.assign({}, typesettingAction.agent, {
          agent: getId(typesetter)
        }),
        actionStatus: 'CompletedActionStatus',
        result: getId(uploadAction),
        autoUpdate: true
      }),
      { acl: typesetter }
    );

    //author updates graph with typeset document
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        actionStatus: 'CompletedActionStatus',
        mergeStrategy: 'ReconcileMergeStrategy',
        agent: getId(arrayify(graph.author)[0]),
        object: getId(uploadAction),
        targetCollection: getId(graph),
        instrumentOf: getId(createReleaseAction)
      },
      { acl: author }
    );

    // authors completes the CRA
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    // editor publish graph
    let publishAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'PublishAction'
    );

    publishAction = await librarian.post(
      Object.assign({}, publishAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0])
      }),
      { acl: user }
    );
  });

  it('should have invoiced submission, publication and service', async () => {
    const upcoming = await librarian.getUpcomingInvoice(getId(organization));
    // console.log(require('util').inspect(upcoming, { depth: null }));

    assert.equal(upcoming.referencesOrder.length, 3);
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
