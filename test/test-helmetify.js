import assert from 'assert';
import { helmetify } from '../src';

describe('helmetify', () => {
  // Old test (here to keep coverage, but do not add to it, add a `describe` per type
  describe('misc', () => {
    function grepMeta(name, obj, options) {
      let { meta } = helmetify(obj, options);
      if (!name) return meta;
      return meta.find(m => m.name === name || m.property === name);
    }

    function P(obj = {}) {
      return Object.assign({ '@type': 'Person', '@id': 'user:dr.banner' }, obj);
    }

    function O(obj = {}) {
      return Object.assign(
        { '@type': 'Organization', '@id': 'user:spacex' },
        obj
      );
    }

    function A(obj = {}) {
      return Object.assign(
        { '@type': 'ScholarlyArticle', '@id': 'scipe:DEAD-BEEF' },
        obj
      );
    }

    function J(obj = {}) {
      return Object.assign(
        { '@type': 'Periodical', '@id': 'scipe:D34D-B33F' },
        obj
      );
    }

    it('must produce correct titles', () => {
      ['twitter', 'og'].forEach(social => {
        let key = `${social}:title`;
        assert.equal(
          grepMeta(key, P({ name: 'Bruce' })).content,
          'Bruce',
          'P.name'
        );
        assert.equal(
          grepMeta(key, P({ givenName: 'Bruce', familyName: 'Banner' }))
            .content,
          'Bruce Banner',
          'P.givenName'
        );
        assert.equal(grepMeta(key, P()).content, 'dr.banner', 'P.id');
        assert.equal(
          grepMeta(key, P({ '@id': null })).content,
          'Anonymous',
          'P fallback'
        );

        assert.equal(
          grepMeta(key, O({ name: 'Hulk' })).content,
          'Hulk',
          'O.name'
        );
        assert.equal(grepMeta(key, O()).content, 'spacex', 'O.id');
        assert.equal(
          grepMeta(key, O({ '@id': null })).content,
          'Unknown Org.',
          'O fallback'
        );

        assert.equal(
          grepMeta(key, J({ name: 'Etiologi.es' })).content,
          'Etiologi.es',
          'J.name'
        );
        assert.equal(
          grepMeta(
            key,
            J({
              alternateName: [
                { '@type': 'rdf:HTML', '@value': '<em>P. of R.</em>' }
              ]
            })
          ).content,
          'P. of R.',
          'J.alternateName'
        );
        assert.equal(
          grepMeta(key, J(), { defaultTitle: 'FOR SCIENCE!' }).content,
          'FOR SCIENCE!',
          'J fallback'
        );

        assert.equal(
          grepMeta(
            key,
            A({
              name: [
                {
                  '@type': 'rdf:HTML',
                  '@value': '<strong>Random Avalanches &amp; Networks</strong>'
                }
              ]
            })
          ).content,
          'Random Avalanches & Networks',
          'A.name'
        );
        assert.equal(
          grepMeta(key, A({ alternativeHeadline: 'OMG! HEADLINE!' })).content,
          'OMG! HEADLINE!',
          'A.alternativeHeadline'
        );
        assert.equal(
          grepMeta(key, A(), {
            defaultTitle: 'FOR SCIENCE!'
          }).content,
          'FOR SCIENCE!',
          'A fallback'
        );
      });
    });

    it('must produce Google Scholar meta', () => {
      let article = A({
        name: {
          '@type': 'rdf:HTML',
          '@value': '<strong>Random Avalanches &amp; Networks</strong>'
        },
        author: [
          {
            '@type': 'ContributorRole',
            author: [
              P({
                givenName: 'Robin',
                familyName: 'Berjon'
              })
            ]
          }
        ],
        isPartOf: {
          '@type': 'PublicationIssue',
          issueNumber: 20,
          isPartOf: {
            '@type': 'PublicationVolume',
            volumeNumber: 17,
            isPartOf: {
              '@type': 'Periodical',
              name: 'The Journal of Friendly Crackpots'
            }
          }
        },
        datePublished: {
          '@type': 'xsd:gYearMonth',
          '@value': '1977-03'
        },
        pagination: '17-42',
        issn: 'ISSN:something',
        isbn: 'ISBN:something'
      });
      assert.equal(
        grepMeta('citation_title', article).content,
        'Random Avalanches & Networks',
        'title'
      );
      assert.equal(
        grepMeta('citation_author', article).content,
        'Robin Berjon',
        'author'
      );
      assert.equal(grepMeta('citation_issue', article).content, '20', 'issue');
      assert.equal(
        grepMeta('citation_volume', article).content,
        '17',
        'volume'
      );
      assert.equal(
        grepMeta('citation_journal_title', article).content,
        'The Journal of Friendly Crackpots',
        'journal'
      );
      assert.equal(
        grepMeta('citation_publication_date', article).content,
        '1977-03',
        'date'
      );
      assert.equal(
        grepMeta('citation_firstpage', article).content,
        '17',
        'first page'
      );
      assert.equal(
        grepMeta('citation_lastpage', article).content,
        '42',
        'last page'
      );
      assert.equal(
        grepMeta('citation_issn', article).content,
        'ISSN:something',
        'ISSN'
      );
      assert.equal(
        grepMeta('citation_isbn', article).content,
        'ISBN:something',
        'ISBN'
      );
    });

    it('picks the right card type', () => {
      assert.equal(
        grepMeta('twitter:card', A()).content,
        'summary',
        'summary card'
      );
      assert.equal(
        grepMeta('twitter:card', A({ image: '/cat.png' })).content,
        'summary_large_image',
        'large summary card'
      );
    });

    it('has required twitter:site', () => {
      assert.equal(
        grepMeta('twitter:site', A()).content,
        '@scipeTweets',
        'twitter handle'
      );
    });

    it('must produce correct descriptions', () => {
      ['twitter', 'og'].forEach(social => {
        let key = `${social}:description`;
        assert.equal(
          grepMeta(key, P({ name: 'Bruce' })).content,
          `User 'Bruce' on sci.pe.`,
          'P default description'
        );
        assert.equal(
          grepMeta(key, P({ name: 'Bruce', description: 'A Cool Frood' }))
            .content,
          `A Cool Frood`,
          'P description'
        );
        assert.equal(
          grepMeta(key, O({ name: 'sci.pe' })).content,
          `Organization 'sci.pe' on sci.pe.`,
          'O default description'
        );
        assert.equal(
          grepMeta(
            key,
            O({
              name: 'sci.pe',
              description: {
                '@type': 'rdf:HTML',
                '@value': '<em>For &quot;Science&quot;</strong>'
              }
            })
          ).content,
          `For "Science"`,
          'O description'
        );
        assert.equal(
          grepMeta(key, J({ alternateName: 'J. of. N.' })).content,
          `Periodical 'J. of. N.' on sci.pe.`,
          'J default description'
        );
        assert.equal(
          grepMeta(key, J({ name: 'Bruce', description: 'The Best Journal' }))
            .content,
          `The Best Journal`,
          'J description'
        );
        assert.equal(
          grepMeta(key, A({ name: 'Cats' })).content,
          `Article 'Cats' on sci.pe.`,
          'A default description'
        );
        assert.equal(
          grepMeta(key, A({ name: 'Foo', description: 'Concrete abstract' }))
            .content,
          `Concrete abstract`,
          'A description'
        );
      });
    });

    it('picks and defaults the right image', () => {
      ['twitter', 'og'].forEach(social => {
        let key = `${social}:image`;
        assert.equal(
          grepMeta(key, A({ image: 'http://ca.ts/cat.png' })).content,
          'http://ca.ts/cat.png',
          '.image'
        );

        assert.equal(
          grepMeta(key, A({ image: '/cat.png' })).content,
          'https://sci.pe/cat.png',
          '.image, default'
        );

        assert.equal(
          grepMeta(key, A({ image: '/cat.png' }), { site: 'http://berjon.com' })
            .content,
          'http://berjon.com/cat.png',
          '.image, default with site'
        );

        assert.equal(
          grepMeta(key, A(), { defaultImg: '/cat.png' }).content,
          'https://sci.pe/cat.png',
          'defaultImg'
        );

        assert.equal(
          grepMeta(
            key,
            A({
              hasPart: {
                '@type': 'Image',
                encoding: {
                  '@type': 'ImageObject',
                  thumbnail: {
                    '@type': 'ImageObject',
                    fileFormat: 'image/png',
                    contentUrl: 'http://ca.ts/cat.png'
                  }
                }
              }
            })
          ).content,
          'http://ca.ts/cat.png',
          'picked from content'
        );
      });
    });

    it('use the right URL', () => {
      ['twitter', 'og'].forEach(social => {
        let key = `${social}:url`;
        assert.equal(
          grepMeta(key, A({ url: 'https://r.sci.pe/test' })).content,
          'https://r.sci.pe/test',
          'A URL'
        );
        assert.equal(
          grepMeta(key, J({ url: 'https://r.sci.pe/' })).content,
          'https://r.sci.pe/',
          'J URL'
        );
        assert.equal(
          grepMeta(key, P({ '@id': 'user:r' })).content,
          'https://r.sci.pe/',
          'P URL'
        );
        assert.equal(
          grepMeta(key, O({ '@id': 'user:nature' })).content,
          'https://nature.sci.pe/',
          'O URL'
        );
        assert.equal(
          grepMeta(key, J(), { site: 'http://berjon.com/' }).content,
          'http://berjon.com/',
          'site'
        );
        assert.equal(
          grepMeta(key, J(), { site: 'http://berjon.com/', path: '/about' })
            .content,
          'http://berjon.com/about',
          'site + path'
        );
      });
    });
  });

  describe('RFAs', () => {
    it('should have right metadata', () => {
      const rfa = {
        '@id': 'action:joghl-1551571200000',
        '@type': 'RequestArticleAction',
        actionStatus: 'ActiveActionStatus',
        startTime: '2019-04-22T16:18:59.742Z',
        url: 'https://joghl.sci.pe/rfas/joghl-1551571200000',
        name: 'Is global health care infrastructure sustainable?',
        description:
          'As health care becomes more available in the developing world, we need to ensure that it is not only accessible to patients but also that it meets their needs and universal quality standards. There is no single way to measure these things, especially given the diversity in types of health care centers and methods of health care delivery. The Journal is seeking studies documenting methodologies for measuring the health and sustainability of local clinics and medical facilities.',
        object: 'journal:joghl',
        about: [
          { '@id': 'subjects:health-care', name: 'Health care' },
          { '@id': 'subjects:health-services', name: 'Health services' }
        ]
      };

      const data = helmetify(rfa);
      const title = data.meta.find(m => m.name === 'twitter:title');
      const description = data.meta.find(m => m.name === 'twitter:description');
      const url = data.meta.find(m => m.name === 'twitter:url');

      assert.equal(title.content, rfa.name);
      assert.equal(data.title, rfa.name);
      assert.equal(description.content, rfa.description);
      assert.equal(url.content, rfa.url);
    });
  });
});
