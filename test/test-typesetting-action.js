import assert from 'assert';
import uuid from 'uuid';
import omit from 'lodash/omit';
import { getObjectId } from 'schema.org/utils';
import { getId, arrayify, unrole } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES, getVersion } from '../src/';

describe('TypesettingAction', function() {
  this.timeout(40000);

  let librarian,
    typesetter,
    author,
    editor,
    organization,
    periodical,
    graph,
    service,
    typesettingAction;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    [typesetter, author, editor] = await Promise.all([
      registerUser({
        '@id': `user:${uuid.v4()}`,
        name: 'peter',
        email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
      }),
      registerUser(),
      registerUser()
    ]);

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(editor),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'org'
        }
      },
      { acl: editor }
    );

    organization = createOrganizationAction.result;

    const createServiceAction = await librarian.post(
      {
        '@type': 'CreateServiceAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(editor),
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
      { acl: editor }
    );

    service = createServiceAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(editor),
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: getId(editor)
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
              grantee: [
                {
                  '@type': 'Audience',
                  audienceType: 'editor'
                },
                {
                  '@type': 'Audience',
                  audienceType: 'producer'
                },
                {
                  '@type': 'Audience',
                  audienceType: 'author'
                }
              ]
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: [
                { '@type': 'Audience', audienceType: 'editor' },
                { '@type': 'Audience', audienceType: 'producer' }
              ]
            }
          ]
        }
      },
      { acl: editor }
    );
    periodical = createPeriodicalAction.result;

    // add typesetter as journal producer
    const inviteTypesetterAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        recipient: {
          roleName: 'producer',
          name: 'typesetter',
          recipient: getId(typesetter)
        },
        object: getId(periodical)
      },
      { acl: editor }
    );
    const acceptInviteTypesetterAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(typesetter),
        object: getId(inviteTypesetterAction)
      },
      { acl: typesetter }
    );
    periodical = acceptInviteTypesetterAction.result.result;

    const createWorkflowSpecificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(editor),
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
                grantee: ALL_AUDIENCES
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
      { acl: editor }
    );

    const workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const graphId = createId('graph', uuid.v4())['@id'];

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        participant: getId(arrayify(periodical.producer)[0]),
        result: {
          '@id': graphId,
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
                fileFormat: 'application/pdf'
              }
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    graph = createGraphAction.result;

    // author buys a TypesettingAction
    const createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );
    service = await librarian.get(
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

    typesettingAction = buyAction.result.orderedItem;
  });

  it('should have instantiated the TypesettingAction', () => {
    assert(getId(typesettingAction));
    // check that `targetedRelease` is here (needed for app-suite selectors)
    assert(getVersion(getId(typesettingAction.targetedRelease)));
  });

  it('should let typesetter access the object of the TypesettingAction', async () => {
    const encoding = await librarian.get(getObjectId(typesettingAction), {
      acl: typesetter
    });

    assert.equal(encoding['@type'], 'DocumentObject');
  });

  it('should let typesetter add a RevisionRequestComment to a TypesettingAction', async () => {
    typesettingAction = await librarian.post(
      Object.assign({}, omit(typesettingAction, ['potentialAction']), {
        agent: Object.assign({}, typesettingAction.agent, {
          agent: getId(typesetter)
        }),
        actionStatus: 'ActiveActionStatus',
        comment: {
          '@type': 'RevisionRequestComment',
          dateCreated: new Date().toISOString(),
          text: 'hello'
        }
      }),
      { acl: typesetter }
    );

    // console.log(require('util').inspect(typesettingAction, { depth: null }));

    // check that an @id was added to the comment
    assert(getId(typesettingAction.comment));
  });

  it('should let typesetter complete a TypesettingAction', async () => {
    // fake upload action

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

    // console.log(require('util').inspect(typesettingAction, { depth: null }));
    assert.equal(typesettingAction.actionStatus, 'CompletedActionStatus');

    // we make sure that the object is embedded
    assert.equal(typesettingAction.object['@type'], 'DocumentObject');

    // check that typesetting action has right audience
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
  });
});
