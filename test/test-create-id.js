import assert from 'assert';
import { getId } from '@scipe/jsonld';
import { parseIndexableString } from '@scipe/collate';
import { createId, getSourceRoleId } from '../src';

describe('createId and associated utils', () => {
  it('should generate @id and _id when called with just a type', () => {
    const id = createId('action');
    assert(id['@id'].startsWith('action:'));
    assert(id._id);
  });

  it('should return @id and _id when called with type id and scopeId ', () => {
    const id = createId('action', 'scienceai:actionId', 'graph:graphId');
    assert.equal(id['@id'], 'action:actionId');
    assert(typeof id._id === 'string');
  });

  it('should generate a graphId', () => {
    const id = createId('graph');
    assert(id['@id'].startsWith('graph:'));
    assert(typeof id._id === 'string');
  });

  it('should generate a graphId and preserve --', () => {
    const id = createId('graph', 'bem__style--modifier');
    assert.deepEqual(id, {
      '@id': 'graph:bem__style--modifier',
      _id: 'graph:bem__style--modifier::graph'
    });
  });

  it('should generate a nodeId when passed a graphId as scope', () => {
    const id = createId('node', 'nodeId', 'graph:graphId');
    assert.equal(id['@id'], 'node:nodeId');
    assert(!('_id' in id));
  });

  it('should generate the @id of a release from the scopeId when provided', () => {
    const id = createId('release', '1.0.0', 'graph:graphId', true);
    assert.equal(id['@id'], 'graph:graphid?version=1.0.0');
    assert(id._id.indexOf('latest'));
  });

  it('should generate a profileId', () => {
    const id = createId('profile', 'username');
    assert(/profile/.test(id._id));
  });

  it('should generate a profileId when given a org.couchdb.user: prefix id', () => {
    const id = createId('profile', 'org.couchdb.user:username');
    const id2 = createId('profile', 'username');
    assert.deepEqual(id, id2);
  });

  it('should generate a blank node @id', () => {
    const id = createId('blank');
    assert(id['@id'].startsWith('_:'));
    assert(!('_id' in id));
  });

  it('should generate a workflow node @id', () => {
    const id = createId('workflow');
    assert(id['@id'].startsWith('workflow:'));
  });

  it('should generate a tag @id', () => {
    const id = createId('tag', 'name with space');
    assert.equal(id['@id'], 'tag:name-with-space');
    assert.equal(createId('tag', id)['@id'], 'tag:name-with-space');
    assert(!('_id' in id));
  });

  it('should generate an audience @id', () => {
    const id = createId(
      'audience',
      'editor',
      'graph:graphId',
      'editor in chief'
    );
    assert.equal(id['@id'], 'audience:ebd870b1c45949a2cba11e37223cb1db');
    assert(!('_id' in id));
  });

  it('should generate a srole @id and test getSourceRoleId', () => {
    const roleId = createId('role');

    const id = createId('srole', null, roleId);
    const sameId = createId('srole', id, roleId);
    assert.equal(sameId['@id'], id['@id']);
    assert.equal(getSourceRoleId(id), getId(roleId));
    assert(!('_id' in id));
  });

  it('should generate a service @id', () => {
    const id = createId('service', 'webify', 'org:scienceai');
    assert.equal(id['@id'], 'service:webify');
    assert(typeof id._id === 'string');
  });

  it('should generate an organization @id', () => {
    const id = createId('org', 'myorg');
    assert.equal(id['@id'], 'org:myorg');
    assert(typeof id._id === 'string');
  });

  it('should generate a contact point @id', () => {
    const id = createId('contact', 'general inquiry', 'user:jen');
    assert.equal(id['@id'], 'contact:user-jen@general-inquiry');
    assert(!('_id' in id));
  });

  describe('PublicationIssue and SpecialPublicationIssue ids', () => {
    const journalId = createId('journal', 'jSlug')['@id'];

    it('should create a special publication issue', () => {
      const issueId = createId('issue', 'iSlug', journalId);
      assert.equal(issueId['@id'], 'issue:jslug/islug');
    });

    it('should be re-entrant', () => {
      const issueId = createId('issue', 'iSlug', journalId);
      assert.equal(
        issueId['@id'],
        createId('issue', issueId['@id'], journalId)['@id']
      );
    });

    it('should create a publication issue (latest case)', () => {
      const issueId = createId('issue', 'iSlug', journalId, true);
      const parsedId = parseIndexableString(issueId._id);
      assert.equal(issueId['@id'], 'issue:jslug/islug');
      assert.deepEqual(parsedId, ['journal:jslug', 'issue', 'latest']);
    });
  });
});
