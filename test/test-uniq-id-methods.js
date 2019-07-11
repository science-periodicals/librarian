import assert from 'assert';
import uuid from 'uuid';
import { Librarian, createId } from '../src';

describe('uniq id methods', function() {
  this.timeout(40000);

  const librarian = new Librarian();

  describe('addUniqId, hasUniqId, removeUniqId', () => {
    it('should addUniqId, hasUniqId, removeUniqId', async () => {
      const slug = uuid.v4();
      await librarian.addUniqId(slug);
      assert(await librarian.hasUniqId(slug));
      await librarian.removeUniqId(slug);
      assert(!(await librarian.hasUniqId(slug)));
    });
  });

  describe('syncUniqIds', () => {
    it('should syncUniqIds', async () => {
      const addedId = createId('org', uuid.v4())['@id'];
      await librarian.addUniqId(addedId);

      const removedId = createId('graph')['@id'];

      const docs = [
        {
          '@id': addedId,
          '@type': 'Organization'
        },
        {
          '@id': removedId,
          '@type': 'Graph',
          _deleted: true
        }
      ];

      await librarian.syncUniqIds(docs);
      assert(await librarian.hasUniqId(addedId));
      assert(!(await librarian.hasUniqId(removedId)));
    });
  });

  describe('hasActiveSubscribeActionId', () => {
    it('should work with active subscribe action virtual id', async () => {
      const orgId = createId('org', uuid.v4())['@id'];
      await librarian.syncUniqIds(
        Object.assign(createId('action', null, orgId), {
          '@type': 'SubscribeAction',
          actionStatus: 'ActiveActionStatus'
        })
      );
      assert(await librarian.hasActiveSubscribeActionId(orgId));

      await librarian.syncUniqIds(
        Object.assign(createId('action', null, orgId), {
          '@type': 'SubscribeAction',
          actionStatus: 'FailedActionStatus'
        })
      );
      assert(!(await librarian.hasActiveSubscribeActionId(orgId)));
    });
  });

  describe('hasCreateCustomerAccountActionId', () => {
    it('should work with create customer action virtual id', async () => {
      const orgId = createId('org', uuid.v4())['@id'];
      await librarian.syncUniqIds(
        Object.assign(createId('action', null, orgId), {
          '@type': 'CreateCustomerAccountAction',
          actionStatus: 'CompletedActionStatus',
          object: orgId
        })
      );
      assert(await librarian.hasCreateCustomerAccountActionId(orgId));

      await librarian.syncUniqIds({
        '@id': orgId,
        '@type': 'Organization',
        _deleted: true
      });
      assert(!(await librarian.hasCreateCustomerAccountActionId(orgId)));
    });
  });

  describe('hasCreatePaymentAccountActionId', () => {
    it('should work with create payment account action virtual id', async () => {
      const orgId = createId('org', uuid.v4())['@id'];
      await librarian.syncUniqIds(
        Object.assign(createId('action', null, orgId), {
          '@type': 'CreatePaymentAccountAction',
          actionStatus: 'CompletedActionStatus',
          object: orgId
        })
      );
      assert(await librarian.hasCreatePaymentAccountActionId(orgId));

      await librarian.syncUniqIds({
        '@id': orgId,
        '@type': 'Organization',
        _deleted: true
      });
      assert(!(await librarian.hasCreatePaymentAccountActionId(orgId)));
    });
  });
});
