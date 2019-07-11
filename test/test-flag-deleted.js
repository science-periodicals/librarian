import assert from 'assert';
import flagDeleted from '../src/utils/flag-deleted';

describe('flagDeleted', () => {
  it('should only preserve userId in roles', () => {
    const action = {
      '@type': 'Action',
      actionStatus: 'ActiveActionStatus',
      name: 'delete me',
      participant: [
        { '@id': 'role:roleId' },
        { '@id': 'audience:audienceId' },
        { participant: 'user:userId' }
      ]
    };

    const now = '2019-06-07T04:16:33.794Z';

    const flagged = flagDeleted(action, { now });
    // console.log(require('util').inspect(flagged, { depth: null }));

    assert.deepEqual(flagged, {
      _deleted: true,
      '@type': 'Action',
      actionStatus: 'ActiveActionStatus',
      dateDeleted: '2019-06-07T04:16:33.794Z',
      participant: ['role:roleId', 'user:userId']
    });
  });
});
