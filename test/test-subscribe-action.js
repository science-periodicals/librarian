import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  getResultId,
  SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID,
  SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID,
  SCIPE_FREE_OFFER_ID,
  SCIPE_EXPLORER_OFFER_ID
} from '../src';

// TODO test with payment token triggering errors (see https://stripe.com/docs/connect/testing)

describe('SubscribeAction', function() {
  this.timeout(40000);

  let librarian, user, organization, subscribeAction, subscriptionId;
  before(async () => {
    librarian = new Librarian();
    user = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': `org:${uuid.v4()}`,
          '@type': 'Organization'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    subscribeAction = await librarian.post(
      {
        '@type': 'SubscribeAction',
        agent: getId(user),
        actionStatus: 'ActiveActionStatus',
        instrument: getId(organization),
        object: 'service:scipe',
        expectsAcceptanceOf: SCIPE_EXPLORER_OFFER_ID,
        paymentToken: {
          '@type': 'PaymentToken',
          value: 'tok_visa' // see https://stripe.com/docs/testing#cards
        }
      },
      { acl: user }
    );

    subscriptionId = getResultId(subscribeAction);
  });

  describe('create subscription', () => {
    it('should have created an Active SubscribeAction', () => {
      // console.log(require('util').inspect(subscribeAction, { depth: null }));
      assert(getId(subscribeAction.result).startsWith('stripe:'));
    });

    it('should have created a stripe customer account', async () => {
      const customer = await librarian.getStripeCustomerByOrganizationId(
        getId(organization)
      );
      // console.log(require('util').inspect(customer, { depth: null }));
      assert.equal(customer.object, 'customer');
    });

    it('should find the subscribe action with the org id', async () => {
      const action = await librarian.getActiveSubscribeAction(
        getId(organization)
      );

      // console.log(require('util').inspect(action, { depth: null }));
      assert.equal(getId(action), getId(subscribeAction));
    });
  });

  describe('update subscription', () => {
    it('should downgrade the subscription and upgrade it again', async () => {
      // Downgrade subscription
      const downgradedSubscribeAction = await librarian.post(
        {
          '@type': 'SubscribeAction',
          agent: getId(user),
          instrument: getId(organization),
          object: 'service:scipe',
          actionStatus: 'ActiveActionStatus',
          expectsAcceptanceOf: SCIPE_FREE_OFFER_ID
        },
        { acl: user }
      );

      // console.log(
      //   require('util').inspect(downgradedSubscribeAction, { depth: null })
      // );
      assert(
        downgradedSubscribeAction.result.items.data.length == 2 &&
          downgradedSubscribeAction.result.items.data.some(
            data => data.plan.id === SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID
          ) &&
          downgradedSubscribeAction.result.items.data.some(
            data => data.plan.id === SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID
          )
      );

      // check that subscribeAction @id was preserved
      assert.equal(getId(downgradedSubscribeAction), getId(subscribeAction));

      // check that stripe subscription.id was preserved
      assert.equal(getResultId(downgradedSubscribeAction), subscriptionId);

      // Upgrade plan
      const reUpgradedSubscribeAction = await librarian.post(
        {
          '@type': 'SubscribeAction',
          agent: getId(user),
          instrument: getId(organization),
          object: 'service:scipe',
          actionStatus: 'ActiveActionStatus',
          expectsAcceptanceOf: SCIPE_EXPLORER_OFFER_ID,
          paymentToken: {
            '@type': 'PaymentToken',
            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
          }
        },
        { acl: user }
      );
      // console.log(require('util').inspect(updateAction, { depth: null }));

      assert(
        reUpgradedSubscribeAction.result.items.data.length == 2 &&
          reUpgradedSubscribeAction.result.items.data.some(
            data => data.plan.id === SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID
          ) &&
          reUpgradedSubscribeAction.result.items.data.some(
            data => data.plan.id === SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID
          )
      );

      assert.equal(getId(reUpgradedSubscribeAction), getId(subscribeAction));
    });
  });

  after(async () => {
    // delete the organization so that the stripe account is deleted
    await librarian.delete(getId(organization), { acl: user });
    return librarian.close();
  });
});
