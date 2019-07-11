import assert from 'assert';
import uuid from 'uuid';
import omit from 'lodash/omit';
import { getId, arrayify, unrole } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getObjectId } from '../src/';

describe('BuyAction', function() {
  this.timeout(40000);

  describe('custom service case', function() {
    let librarian,
      user,
      author,
      organization,
      periodical,
      defaultCreateGraphAction,
      service;
    before(async () => {
      librarian = new Librarian({ skipPayments: true });
      [user, author] = await Promise.all([registerUser(), registerUser()]);

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
              },
              addOn: {
                '@type': 'Offer',
                priceSpecification: {
                  '@type': 'PriceSpecification',
                  price: 10,
                  priceCurrency: 'USD',
                  valueAddedTaxIncluded: false,
                  platformFeesIncluded: false
                },
                eligibleCustomerType: 'RevisionAuthor'
              }
            }
          }
        },
        { acl: user }
      );

      service = createServiceAction.result;

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
                    '@id': '_:submissionStage',
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
                          potentialAction: [
                            {
                              '@type': 'AssessAction',
                              actionStatus: 'ActiveActionStatus',
                              agent: { '@type': 'Role', roleName: 'editor' },
                              participant: {
                                '@type': 'Audience',
                                audienceType: 'editor'
                              },
                              potentialResult: [
                                '_:submissionStage',
                                {
                                  '@type': 'StartWorkflowStageAction',
                                  participant: ALL_AUDIENCES,
                                  result: [
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
                                },
                                {
                                  '@type': 'RejectAction',
                                  actionStatus: 'PotentialActionStatus',
                                  agent: { '@type': 'Role', roleName: 'editor' }
                                }
                              ]
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
    });

    it('should buy a service and instantiate the associated service action', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.producer)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(author)
            },
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
      const graph = createGraphAction.result;

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const service = await librarian.get(
        arrayify(createReleaseAction.potentialService)[0],
        { acl: author }
      );

      const offer = service.offers;
      const buyActionTemplate = arrayify(offer.potentialAction)[0];

      const typesettingActionId = createId('action', null, graph)['@id']; // we allow to specify typesetting action ahead of time for stories
      const buyAction = await librarian.post(
        Object.assign({}, buyActionTemplate, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          instrumentOf: getId(createReleaseAction),
          paymentToken: {
            '@type': 'PaymentToken',
            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
          },
          object: getId(service.offers),
          result: { orderedItem: typesettingActionId }
        }),
        {
          acl: author
        }
      );
      // console.log(require('util').inspect(buyAction, { depth: null }));

      assert(getId(buyAction) !== getId(buyActionTemplate));
      assert.equal(getId(buyAction.instanceOf), getId(buyActionTemplate));

      // check that typesetting action (service output) has right audience
      const typesettingAction = buyAction.result.orderedItem;
      assert(
        arrayify(typesettingAction.participant).some(
          participant =>
            unrole(participant, 'participant').audienceType === 'author'
        ) &&
          arrayify(typesettingAction.participant).some(
            participant =>
              unrole(participant, 'participant').audienceType === 'producer'
          ) &&
          arrayify(typesettingAction.participant).some(
            participant => participant.roleName === 'customer'
          )
      );

      // check that content checksum was re-embedded
      assert.equal(
        arrayify(typesettingAction.object.contentChecksum)[0].checksumValue,
        'sha'
      );

      // check that @id was preserved
      assert.equal(getId(typesettingAction), typesettingActionId);

      // check that identifier was added
      assert.equal(typesettingAction.identifier, '0.2');
    });

    it('should allow a RevisionAuthor to buy an addOn offer after a revision', async () => {
      // first we complete the first submission (buying the first offer)
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
            producer: getId(arrayify(periodical.producer)[0]),
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
      const resource = graph['@graph'].find(
        node => node['@type'] === 'ScholarlyArticle'
      );

      const stage = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'StartWorkflowStageAction'
      );
      let createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );
      let assessAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'AssessAction'
      );

      const service = await librarian.get(
        arrayify(createReleaseAction.potentialService)[0],
        { acl: author }
      );

      const offer = service.offers;
      const buyActionTemplate = arrayify(offer.potentialAction)[0];

      const buyAction = await librarian.post(
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

      // fake upload action
      const uploadAction = await librarian.put(
        Object.assign(createId('action', null, graph), {
          '@type': 'UploadAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          object: {
            '@type': 'DocumentObject',
            encodesCreativeWork: getId(resource),
            isNodeOf: getId(graph)
          },
          result: {
            '@type': 'DocumentObject',
            encodesCreativeWork: getId(resource),
            contentUrl: '/encoding/typesetted.ds3.docx',
            isNodeOf: getId(graph),
            isBasedOn: getObjectId(typesettingAction)
          }
        })
      );

      typesettingAction = await librarian.post(
        Object.assign({}, omit(typesettingAction, ['potentialAction']), {
          agent: Object.assign({}, typesettingAction.agent, {
            agent: getId(user)
          }),
          actionStatus: 'CompletedActionStatus',
          result: getId(uploadAction)
        }),
        { acl: user }
      );

      // Author update graph with the upload action
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(author),
          actionStatus: 'CompletedActionStatus',
          instrumentOf: getId(createReleaseAction),
          object: getId(uploadAction),
          mergeStrategy: 'ReconcileMergeStrategy',
          targetCollection: getId(graph)
        },
        { acl: author }
      );

      graph = updateAction.result;

      // author complete the CRA
      createReleaseAction = await librarian.post(
        Object.assign({}, createReleaseAction, {
          agent: getId(author),
          actionStatus: 'CompletedActionStatus'
        }),
        { acl: author }
      );

      // editor sent back to submission stage to get a cycle so that author can purchase the offer addOn (for RevisionAuthor)
      assessAction = await librarian.post(
        Object.assign({}, assessAction, {
          agent: getId(arrayify(graph.editor)[0]),
          actionStatus: 'CompletedActionStatus',
          result: getId(
            arrayify(assessAction.potentialResult).find(
              result => getId(result.instanceOf) === getId(stage.instanceOf)
            )
          )
        }),
        { acl: user }
      );

      const nextStage = assessAction.result;
      const revisionCreateReleaseAction = arrayify(nextStage.result).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      // author replace the MS by a PDF
      const updateRevisionAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(author),
          actionStatus: 'CompletedActionStatus',
          mergeStrategy: 'ReconcileMergeStrategy',
          instrumentOf: getId(revisionCreateReleaseAction),
          object: {
            '@graph': [
              {
                '@id': getId(resource),
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
          },
          targetCollection: getId(graph)
        },
        { acl: author }
      );

      graph = updateRevisionAction.result;

      // this time we buy the addOn
      const addOnOffer = service.offers.addOn;
      const addOnBuyActionTemplate = arrayify(addOnOffer.potentialAction)[0];

      const buyAddOnAction = await librarian.post(
        Object.assign({}, addOnBuyActionTemplate, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          instrumentOf: getId(revisionCreateReleaseAction),
          object: getId(addOnOffer),
          paymentToken: {
            '@type': 'PaymentToken',
            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
          }
        }),
        {
          acl: author
        }
      );

      // console.log(require('util').inspect({ buyAddOnAction }, { depth: null }));
      assert(buyAddOnAction.result.orderedItem);
    });
  });

  describe('Brokerable service case ', function() {
    let librarian,
      admin,
      user,
      author,
      typesetter,
      serviceProviderOrganization,
      organization,
      periodical,
      defaultCreateGraphAction,
      service;

    before(async () => {
      librarian = new Librarian({ skipPayments: true });
      [admin, user, author, typesetter] = await Promise.all([
        registerUser({ memberOf: 'acl:admin' }),
        registerUser(),
        registerUser(),
        registerUser()
      ]);

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

      service = createServiceAction.result;

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
    });

    it('should buy a service and instantiate the associated service action and add the organization typesetter to the Graph', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.producer)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(author)
            },
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

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const service = await librarian.get(
        arrayify(createReleaseAction.potentialService)[0],
        { acl: author }
      );

      const offer = service.offers;
      const buyActionTemplate = arrayify(offer.potentialAction)[0];

      const buyAction = await librarian.post(
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
      // console.log(require('util').inspect(buyAction, { depth: null }));

      assert(getId(buyAction) !== getId(buyActionTemplate));
      assert.equal(getId(buyAction.instanceOf), getId(buyActionTemplate));

      // check that typesetting action (service output) has right audience
      const typesettingAction = buyAction.result.orderedItem;
      assert.equal(typesettingAction.actionStatus, 'ActiveActionStatus');

      // check that typesetter was added to the Graph under a new roleId
      const serviceProvider = arrayify(organization.member).find(
        member => member.name === 'typesetter'
      );
      graph = await librarian.get(graph, { acl: typesetter });
      const typesetterRole = arrayify(graph.producer).find(
        role => role.name === 'typesetter'
      );

      assert.equal(getId(typesettingAction.agent), getId(typesetterRole));
      assert(getId(typesettingAction.agent) !== getId(serviceProvider)); // graph role is different from org role
    });

    it('should allow to specify the typesetter graph @id through sameAs (for stories)', async () => {
      const createGraphAction = await librarian.post(
        Object.assign({}, defaultCreateGraphAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(author),
          participant: getId(arrayify(periodical.producer)[0]),
          result: {
            '@id': createId('graph', uuid.v4())['@id'],
            '@type': 'Graph',
            author: {
              roleName: 'author',
              author: getId(author)
            },
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

      const createReleaseAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'CreateReleaseAction'
      );

      const service = await librarian.get(
        arrayify(createReleaseAction.potentialService)[0],
        { acl: author }
      );

      const offer = service.offers;
      const buyActionTemplate = arrayify(offer.potentialAction)[0];

      const orgTypesetter = arrayify(serviceProviderOrganization.member).find(
        role => role.name === 'typesetter'
      );

      const typesetterGraphRoleId = createId('role', null)['@id'];

      const buyAction = await librarian.post(
        Object.assign({}, buyActionTemplate, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0]),
          participant: {
            '@id': getId(orgTypesetter),
            sameAs: typesetterGraphRoleId
          },
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

      // console.log(require('util').inspect(buyAction, { depth: null }));

      graph = await librarian.get(graph, { acl: typesetter });
      const graphTypesetter = arrayify(graph.producer).find(
        role => role.name === 'typesetter'
      );
      assert.equal(getId(graphTypesetter), getId(typesetterGraphRoleId));
    });
  });
});
