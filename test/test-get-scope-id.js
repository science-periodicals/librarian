import assert from 'assert';
import { getScopeId, createId } from '../src';

describe('getScopeId', () => {
  it('should not throw with undefined', () => {
    assert.equal(getScopeId(), undefined);
  });

  it('should get the scopeId with release', () => {
    const graphId = createId('graph')['@id'];
    const releaseId = createId('release', '1.0.0', graphId)['@id'];

    assert.equal(getScopeId(releaseId), graphId);
    assert.equal(getScopeId({ '@id': releaseId }), graphId);
  });

  it('should get the scopeId in case of user / profile documents when _id and @id are provided', () => {
    const profile = createId('profile', createId('user', 'username'));
    const scopeId = getScopeId(profile);
    assert.equal(scopeId, 'user:username');
  });

  it('should get the scopeId in case of user / profile documents when only @id is provided', () => {
    const profile = createId('profile', createId('user', 'username'));
    const scopeId = getScopeId(profile['@id']);
    assert.equal(scopeId, 'user:username');
  });
});
