import assert from 'assert';
import { getPurl } from '../src/';

describe('getPurl', () => {
  it('should work with an undefined graph', () => {
    assert(getPurl().startsWith('https://purl.org'));
  });
});
