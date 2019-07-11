import assert from 'assert';
import { updateNode } from '../src';

describe('pouch utils', function() {
  describe('updateNode', () => {
    it('should update a node', () => {
      const node = {
        '@id': 'id',
        name: 'name',
        list: ['a']
      };
      const upd = {
        '@id': 'id',
        value: 'value',
        list: 'b'
      };
      const updated = updateNode(node, upd);
      assert.deepEqual(updated, {
        '@id': 'id',
        name: 'name',
        value: 'value',
        list: ['a', 'b']
      });
    });

    it('should update a node replacing array values', () => {
      const node = {
        '@id': 'id',
        name: 'name',
        list: ['a']
      };
      const upd = {
        '@id': 'id',
        value: 'value',
        list: ['b']
      };
      const updated = updateNode(node, upd, { replaceArray: true });
      assert.deepEqual(updated, {
        '@id': 'id',
        name: 'name',
        value: 'value',
        list: ['b']
      });
    });

    it('should replace a node', () => {
      const node = {
        '@id': 'id',
        name: 'name',
        list: ['a']
      };
      const upd = {
        '@id': 'id',
        value: 'value'
      };
      const updated = updateNode(node, upd, { replace: true });
      assert.deepEqual(updated, {
        '@id': 'id',
        value: 'value'
      });
    });
  });
});
