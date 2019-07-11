import assert from 'assert';
import { escJSON } from '../src';

describe('escJSON', () => {
  it('should work with null or undefined', () => {
    assert.equal(escJSON(null), 'null');
    assert.equal(escJSON(), undefined);
  });

  it('should work with objects', () => {
    assert.deepEqual(escJSON({ a: 1 }), '{"a":1}');
  });
});
