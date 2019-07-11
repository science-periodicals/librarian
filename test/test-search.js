import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src';

describe('search', function() {
  this.timeout(40000);

  let librarian,
    user,
    author,
    contrib,
    organization,
    periodical,
    workflowSpecification,
    graph;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [user, author, contrib] = await Promise.all(
      ['peter', 'jen', 'lea'].map(name => {
        return registerUser({
          '@id': `user:${uuid.v4()}`,
          name,
          email: `${uuid.v4()}@science.ai`,
          password: uuid.v4()
        });
      })
    );

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

    // create service so we can test search for services
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

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        agent: {
          roleName: 'author',
          agent: user['@id']
        },
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          editor: [
            {
              '@id': '_:editor1',
              roleName: 'editor',
              editor: user
            },
            {
              '@id': '_:editor2',
              roleName: 'editor',
              name: 'editor in chief',
              editor: user
            }
          ],
          producer: {
            '@id': '_:producer',
            roleName: 'producer',
            producer: user
          },
          reviewer: {
            '@id': '_:reviewer',
            roleName: 'reviewer',
            contributor: user
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
              permissionType: 'AdminPermission',
              grantee: user['@id']
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'editor'
              }
            }
          ].concat(
            ['reviewer', 'author', 'producer', 'public'].map(audienceType => {
              return {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType
                }
              };
            })
          )
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;

    // create an RFA
    const requestArticleAction = await librarian.post(
      {
        '@type': 'RequestArticleAction',
        agent: getId(arrayify(periodical.editor)[0]),
        actionStatus: 'ActiveActionStatus',
        object: getId(periodical)
      },
      { acl: user }
    );

    const createPublicationTypeAction = await librarian.post(
      {
        '@type': 'CreatePublicationTypeAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'PublicationType',
          name: 'Research Article'
        }
      },
      { acl: user }
    );

    const createWorkflowSepcificationAction = await librarian.post(
      {
        '@type': 'CreateWorkflowSpecificationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'WorkflowSpecification',
          expectedDuration: 'P60D',
          potentialAction: {
            '@type': 'CreateGraphAction',
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: [
                {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'AdminPermission',
                  grantee: {
                    '@type': 'Audience',
                    audienceType: 'editor'
                  }
                },
                {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'WritePermission',
                  grantee: {
                    '@type': 'Audience',
                    audienceType: 'author'
                  }
                }
              ].concat([
                {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'ReadPermission',
                  grantee: [
                    'editor',
                    'author',
                    'reviewer',
                    'producer',
                    'public'
                  ].map(audienceType => {
                    return {
                      '@type': 'Audience',
                      audienceType
                    };
                  })
                }
              ])
            }
          }
        }
      },
      { acl: user }
    );

    workflowSpecification = createWorkflowSepcificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const mainEntityId = `node:${uuid.v4()}`;
    const contributorRoleId = `role:${uuid.v4()}`;
    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        agent: getId(author),
        participant: [
          getId(arrayify(periodical.editor)[0]),
          getId(arrayify(periodical.reviewer)[0])
        ],
        actionStatus: 'CompletedActionStatus',
        result: {
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(arrayify(periodical.editor)[0]),
          reviewer: getId(arrayify(periodical.reviewer)[0]),
          mainEntity: mainEntityId,
          '@graph': [
            {
              '@id': mainEntityId,
              '@type': 'ScholarlyArticle',
              contributor: contributorRoleId
            },
            {
              '@id': contributorRoleId,
              '@type': 'ContributorRole',
              contributor: getId(contrib),
              roleName: 'author'
            },
            {
              '@id': getId(contrib),
              '@type': 'Person'
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );

    graph = createGraphAction.result;

    // console.log(require('util').inspect(graph, { depth: null }));

    // Add TagAction for the special case of the Tag facet ACL
    // Create a tag only visible to authors
    const authorTagAction = await librarian.post(
      {
        '@type': 'TagAction',
        agent: getId(arrayify(graph.author)[0]),
        actionStatus: 'CompletedActionStatus',
        object: getId(graph),
        result: {
          name: 'author tag'
        }
      },
      { acl: author }
    );

    // Create a tag only visible to editors
    const editorTagAction = await librarian.post(
      {
        '@type': 'TagAction',
        agent: getId(arrayify(graph.editor)[0]),
        actionStatus: 'CompletedActionStatus',
        object: getId(graph),
        result: {
          name: 'editor tag'
        }
      },
      { acl: user }
    );
  });

  describe('types', () => {
    it('should search for publication types', done => {
      librarian.search(
        'type',
        {
          counts: ['@type'],
          includeDocs: true
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          // console.log(require('util').inspect(itemList, { depth: null }));
          assert(itemList.numberOfItems, 'there are results');
          assert(itemList.itemListFacet, 'there are facets');
          done();
        }
      );
    });
  });

  describe('services', () => {
    it('should search for services', done => {
      librarian.search(
        'service',
        {
          counts: ['providerId']
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          assert(itemList.numberOfItems, 'there are results');
          assert(itemList.itemListFacet, 'there are facets');
          done();
        }
      );
    });
  });

  describe('periodicals', () => {
    it('should search', done => {
      librarian.search(
        'periodical',
        {
          counts: ['editorId'],
          ranges: {
            dateCreated: {
              now: `[${new Date(
                '2012-01-01'
              ).getTime()} TO ${new Date().getTime()}]`
            }
          }
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);

          //console.log(require('util').inspect(itemList, { depth: null }));

          assert(
            itemList.itemListFacet[0].count.some(
              count => count.name === 'peter'
            ),
            'the id2name view was called and worked'
          );
          done();
        }
      );
    });

    it('should return all the facets if called with defaultFacetQuery', done => {
      librarian.search(
        'periodical',
        {
          defaultFacetQuery: '*:*',
          query: 'creatorId:unknown',
          counts: ['editorId']
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          assert.equal(itemList.itemListFacet[0].count[0].value, 0);
          done();
        }
      );
    });

    it('should handle the facetQuery option', done => {
      librarian.search(
        'periodical',
        {
          query: 'creator:unknown',
          facetQuery: '*:*',
          counts: ['editorId'],
          limit: 0
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          assert(
            itemList.itemListFacet[0].count.some(
              count => count.name === 'peter'
            )
          );
          done();
        }
      );
    });

    it('should search for public periodical when user is anonymous (case for public sifter)', done => {
      librarian.search(
        'periodical',
        {
          query: `@id:"${periodical['@id']}"`,
          potentialActions: true,
          hydrate: ['editor'],
          includeDocs: true,
          counts: ['editorId']
        },
        { acl: true, baseUrl: 'http://example.com' },
        (err, body) => {
          if (err) return done(err);

          assert(
            body.mainEntity.itemListFacet[0].count.some(
              count => count.name === 'peter'
            ),
            'the id2name view was called and worked'
          );
          done();
        }
      );
    });

    it('should work with 0 result', done => {
      librarian.search(
        'periodical',
        {
          query: 'author:unknown',
          counts: ['editorId'],
          ranges: {
            dateCreated: {
              now: `[${new Date(
                '2012-01-01'
              ).getTime()} TO ${new Date().getTime()}]`
            }
          }
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          assert.equal(itemList.itemListFacet[0].count, 0);
          done();
        }
      );
    });
  });

  describe('graphs', () => {
    it('should search for public graph when user is anonymous (case for public sifter)', done => {
      librarian.search(
        'graph',
        {
          query: `@id:"${graph['@id']}"`,
          includeDocs: true,
          potentialActions: false
        },
        { acl: true, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);

          const graph = itemList.itemListElement[0].item;
          assert.equal(graph['@type'], 'Graph');
          done();
        }
      );
    });

    it('should not leak tag user should not see', done => {
      librarian.search(
        'graph',
        {
          query: `@id:"${graph['@id']}"`,
          counts: ['tagId'],
          includeDocs: false,
          potentialActions: false
        },
        { acl: user, baseUrl: 'http://example.com' },
        (err, body) => {
          if (err) return done(err);
          // console.log(require('util').inspect(body, { depth: null }));
          const tagFacet = body.itemListFacet.find(
            facet => facet.name === 'tagId'
          );

          assert.equal(
            tagFacet.count.length,
            1,
            'only 1 tag, the one visible to editors'
          );
          assert(
            tagFacet.count.some(count => count.propertyId === 'tag:editor-tag')
          );

          done();
        }
      );
    });

    it('should take over include_docs', done => {
      librarian.search(
        'graph',
        {
          query: `@id:"${graph['@id']}"`,
          includeDocs: true,
          potentialActions: 'all'
        },
        { acl: author, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);

          const graph = itemList.itemListElement[0].item;
          assert.equal(graph['@type'], 'Graph');
          done();
        }
      );
    });

    it('should hydrate search', done => {
      librarian.search(
        'graph',
        {
          includeDocs: true,
          query: `authorId:"${author['@id']}"`,
          hydrate: ['creator', 'author', 'isPartOf', 'publisher', 'workflow']
        },
        { acl: author, baseUrl: 'http://example.com' },
        (err, body) => {
          if (err) return done(err);
          // console.log(require('util').inspect(body, { depth: null }));

          const graph = body.mainEntity.itemListElement[0].item;

          assert.equal(body['@type'], 'HydratedSearchResultList');
          assert.equal(body.mainEntity['@type'], 'SearchResultList');
          assert(body['@graph'].some(node => node['@id'] === user['@id']));
          assert(
            body['@graph'].some(node => node['@id'] === organization['@id'])
          );
          assert(
            body['@graph'].some(node => node['@id'] === graph.workflow),
            'workflow was hydrated'
          );
          done();
        }
      );
    });

    it('main entity contributors (not directly present in the Graph) should be able to find graph they contribute to (useful in dashboard)', async () => {
      const res = await librarian.search(
        'graph',
        {
          includeDocs: true,
          query: `entityContributorId:"${contrib['@id']}"`,
          addActiveRoleIds: true // needed given the blinding (entity userId are not indexed to preserve anonimity)
        },
        { acl: contrib }
      );

      assert.equal(res.numberOfItems, 1);
    });
  });

  describe('action', () => {
    it('should work with the addActiveRoleIds option', done => {
      librarian.search(
        'action',
        {
          counts: ['@type'],
          includeDocs: true
        },
        { acl: author, baseUrl: 'http://example.com', addActiveRoleIds: true },
        (err, itemList) => {
          if (err) return done(err);
          // console.log(require('util').inspect(itemList, { depth: null }));
          assert(itemList.numberOfItems, 'there are results');
          assert(itemList.itemListFacet, 'there are facets');
          done();
        }
      );
    });

    it('should search for public RFA actions', done => {
      librarian.search(
        'action',
        {
          query: '@type:"RequestArticleAction"',
          includeDocs: true
        },
        { acl: true, baseUrl: 'http://example.com' },
        (err, itemList) => {
          if (err) return done(err);
          // console.log(require('util').inspect(itemList, { depth: null }));
          assert(itemList.numberOfItems, 'there are results');
          done();
        }
      );
    });
  });
});
