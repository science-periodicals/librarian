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

// TODO test with token that trigger errors (see https://stripe.com/docs/connect/testing)

describe('Charges', function() {
  this.timeout(40000);

  let librarian,
    user,
    author,
    organization,
    periodical,
    subscribeAction,
    payAction,
    buyAction,
    createPaymentAccountAction,
    defaultCreateGraphAction;

  const beginStripe = Math.floor(new Date().getTime() / 1000);
  let endStripe;

  before(async () => {
    librarian = new Librarian();
    user = await registerUser();
    author = await registerUser();

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

    // console.log(require('util').inspect(acceptAction, { depth: null }));

    createPaymentAccountAction = await librarian.post(
      {
        '@type': 'CreatePaymentAccountAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(organization),
        result: {
          country: 'US',
          external_account: {
            object: 'bank_account',
            country: 'US',
            currency: 'usd',
            // see https://stripe.com/docs/connect/testing#account-numbers
            routing_number: '110000000',
            account_number: '000123456789'
          }
        }
      },
      { acl: user }
    );

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
            name: 'typesetter',
            editor: getId(user)
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
                        potentialAction: [
                          {
                            '@type': 'PayAction',
                            actionStatus: 'ActiveActionStatus',
                            name: 'Article processing charge',
                            agent: {
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
                            priceSpecification: {
                              '@type': 'PriceSpecification',
                              price: 100,
                              priceCurrency: 'USD'
                            }
                          },
                          {
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
                        ]
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
        participant: [
          getId(arrayify(periodical.editor)[0]),
          getId(arrayify(periodical.producer)[0])
        ],
        result: {
          '@id': createId('graph', uuid.v4())['@id'],
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(arrayify(periodical.editor)[0]),
          producer: getId(arrayify(periodical.producer)[0]),
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

    buyAction = await librarian.post(
      Object.assign({}, buyActionTemplate, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        instrumentOf: getId(createReleaseAction),
        object: getId(service.offers),
        paymentToken: {
          '@type': 'PaymentToken',
          value: 'tok_visa' // see https://stripe.com/docs/testing#cards
        }
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
        agent: getId(arrayify(graph.producer)[0]),
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
        agent: getId(arrayify(graph.producer)[0]),
        actionStatus: 'CompletedActionStatus',
        result: getId(uploadAction),
        autoUpdate: true
      }),
      { acl: user }
    );

    // author updates graph with typeset document
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

    // author completes the CRA
    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    // author completes the PayAction
    payAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'PayAction'
    );

    payAction = await librarian.post(
      Object.assign({}, payAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        paymentToken: {
          '@type': 'PaymentToken',
          value: 'tok_visa' // see https://stripe.com/docs/testing#cards
        }
      }),
      { acl: author }
    );

    endStripe = Math.ceil(new Date().getTime() / 1000);
  });

  it('should have charged the author for the BuyAction and the PayAction', async () => {
    const charges = await librarian.stripe.charges.list({
      created: {
        gte: beginStripe,
        lte: endStripe
      }
    });

    // console.log(require('util').inspect(charges, { depth: null }));

    const apcCharge = charges.data.find(
      charge => charge.metadata && charge.metadata.actionId === getId(payAction)
    );
    assert(apcCharge);
    // console.log(require('util').inspect(apcCharge, { depth: null }));
    // check that taxe was applied
    assert.equal(apcCharge.transfer_data.amount, 7000);

    const authorServiceCharge = charges.data.find(
      charge => charge.metadata && charge.metadata.actionId === getId(buyAction)
    );
    // console.log(require('util').inspect(authorServiceCharge, { depth: null }));
    assert(authorServiceCharge);
    assert.equal(authorServiceCharge.transfer_data.amount, 700);
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
