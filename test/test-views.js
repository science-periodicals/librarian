import assert from 'assert';
import { Librarian, createId } from '../src';

describe('views', function() {
  this.timeout(40000);

  let librarian = new Librarian({ skipPayments: true });

  describe('getEncodingCountsByChecksumAndScopeId', () => {
    let graph;
    before(done => {
      const graphId = createId('graph');
      librarian.put(
        Object.assign(graphId, {
          '@type': 'Graph',
          '@graph': [
            {
              '@id': createId('node', null, graphId)['@id'],
              '@type': 'Checksum',
              checksumAlgorithm: 'sha256',
              checksumValue: '42'
            }
          ]
        }),
        { acl: false },
        (err, doc) => {
          if (err) {
            return done(err);
          }
          graph = doc;
          done();
        }
      );
    });

    it('should return the count when matching', done => {
      const node = graph['@graph'][0];
      librarian.getEncodingCountsByChecksumAndScopeId(
        node.checksumValue,
        graph['@id'],
        (err, count) => {
          if (err) return done(err);
          assert.equal(count, 1);
          done();
        }
      );
    });

    it('should return the count when not matching', done => {
      librarian.getEncodingCountsByChecksumAndScopeId(
        'xxx',
        graph['@id'],
        (err, count) => {
          if (err) return done(err);
          assert.equal(count, 0);
          done();
        }
      );
    });
  });
});
