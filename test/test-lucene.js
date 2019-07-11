import assert from 'assert';
import { escapeLucene } from '../src';

describe('queries', () => {
  describe('escaping', () => {
    it('should escape queries', () => {
      assert.equal('user\\:foo', escapeLucene('user:foo'), 'user:foo');
    });
  });
});
