import assert from 'assert';
import { createId, mapChangeToSchema } from '../src';

describe('low level API', function() {
  describe('mapChangeToSchema', () => {
    it('should map a CouchDB change to a DataFeedItem', () => {
      const profile = Object.assign(createId('profile', 'peter'), {
        _rev: '1-84382e1aee91729be35ce51e76256966',
        '@type': 'Person',
        memberOf: {
          '@type': 'OrganizationRole',
          memberOf: 'https://sci.pe',
          startDate: '2016-10-07T16:15:20.498Z'
        }
      });

      const change = {
        seq: 2,
        id: profile._id,
        changes: [{ rev: profile._rev }],
        doc: profile
      };

      const dataFeedItem = mapChangeToSchema(change);
      assert(dataFeedItem['@id'].startsWith('seq:'));
      assert.equal(dataFeedItem.dateCreated, profile.memberOf.startDate);
    });
  });
});
