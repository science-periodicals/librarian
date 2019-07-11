import assert from 'assert';
import { flatten, getId } from '@scipe/jsonld';
import {
  getParts,
  getRootPart,
  getRootPartId,
  getChecksumValue,
  getAgent,
  getAgentId,
  getObject,
  getObjectId,
  getTargetCollection,
  getTargetCollectionId,
  getUrlTemplateCtx
} from '../src/';

describe('schema utils', function() {
  describe('getParts', function() {
    const tree = {
      '@context': {
        hasPart: {
          '@id': 'http://schema.org/hasPart',
          '@type': '@id',
          '@container': '@list'
        }
      },
      '@id': 'root',
      hasPart: [
        {
          '@id': 'a',
          hasPart: [{ '@id': 'b', hasPart: [{ '@id': 'c' }, { '@id': 'd' }] }]
        }
      ]
    };

    it('should work with a tree', function() {
      assert.deepEqual(getParts(tree).map(getId), ['a', 'b', 'c', 'd']);
    });

    it('should work with a graph', function(done) {
      flatten(tree, (err, flat) => {
        assert.deepEqual(getParts('root', flat).map(getId), [
          'a',
          'b',
          'c',
          'd'
        ]);
        done();
      });
    });
  });

  describe('getRootPart', function() {
    it('should get the root part', function() {
      const tree = {
        '@id': '_:1',
        isPartOf: {
          '@id': '_:2',
          isPartOf: {
            '@id': '_:3',
            isPartOf: '_:4'
          }
        }
      };

      assert.equal(getRootPart(tree), '_:4');
      assert.equal(getRootPartId(tree), '_:4');
    });
  });

  describe('getAgent', function() {
    it('should unrolify or return the agent if not a role', function() {
      assert.equal(getAgent({ author: 'ex:authorId' }), 'ex:authorId');
      assert.equal(getAgent('ex:authorId'), 'ex:authorId');
    });

    it('should get the agent Id', function() {
      assert.equal(
        getAgentId({ author: { '@id': 'ex:authorId' } }),
        'ex:authorId'
      );
    });
  });

  describe('getObject', function() {
    it('should unrolify', function() {
      assert.deepEqual(
        getObject({ object: { object: { '@id': 'ex:objectId' } } }),
        { '@id': 'ex:objectId' }
      );
    });

    it('should unrolify and get the @id', function() {
      assert.equal(
        getObjectId({ object: { object: { '@id': 'ex:objectId' } } }),
        'ex:objectId'
      );
    });
  });

  describe('getTargetCollection', function() {
    it('should unrolify', function() {
      assert.deepEqual(
        getTargetCollection({
          targetCollection: {
            targetCollection: { '@id': 'ex:targetCollectionId' }
          }
        }),
        { '@id': 'ex:targetCollectionId' }
      );
    });

    it('should unrolify and get the @id', function() {
      assert.equal(
        getTargetCollectionId({
          targetCollection: {
            targetCollection: { '@id': 'ex:targetCollectionId' }
          }
        }),
        'ex:targetCollectionId'
      );
    });
  });

  describe('getChecksumValue', function() {
    it('should get the nash', function() {
      const doc = {
        contentChecksum: [
          {
            checksumAlgorithm: 'nash',
            checksumValue: 'nash'
          },
          {
            checksumAlgorithm: 'sha-256',
            checksumValue: 'sha-256'
          }
        ]
      };
      assert.equal(getChecksumValue(doc), 'nash');
    });
  });

  describe('getUrlTemplateCtx', function() {
    it('should get urlTemplate context from an action', function() {
      let action = {
        'a-input': {
          valueName: 'a',
          defaultValue: 'aa'
        },
        target: {
          'b-input': {
            valueName: 'b',
            defaultValue: 'bb'
          }
        }
      };
      var ctx = getUrlTemplateCtx(action, { a: 'aaa' });
      assert.deepEqual(ctx, { a: 'aaa', b: 'bb' });
    });
  });
});
