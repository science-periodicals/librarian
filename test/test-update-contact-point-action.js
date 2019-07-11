import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, CONTACT_POINT_ADMINISTRATION, Store } from '../src';

describe('UpdateContactPointAction', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();
  });

  it('should update a contact point and validate it', async () => {
    const contactPoint = arrayify(user.contactPoint).find(
      contactPoint => contactPoint.contactType === CONTACT_POINT_ADMINISTRATION
    );

    const token = {
      '@type': 'Token',
      tokenType: 'emailVerificationToken',
      value: uuid.v4()
    };

    const store = new Store();
    const updatedEmail = `mailto:success+${uuid.v4()}@simulator.amazonses.com`;
    const updateContactPointAction = await librarian.post(
      {
        '@type': 'UpdateContactPointAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: {
          email: updatedEmail
        },
        targetCollection: getId(contactPoint),
        instrument: token,
        potentialAction: {
          '@type': 'InformAction',
          actionStatus: 'CompletedActionStatus',
          instrument: {
            '@type': 'EmailMessage',
            text: {
              '@type': 'sa:ejs',
              '@value': 'token=<%= emailVerificationToken.value %>'
            }
          }
        }
      },
      { acl: user, store, strict: false }
    );

    // console.log(
    //   require('util').inspect(updateContactPointAction, { depth: null })
    // );

    // check that token value made it to the email
    assert(
      arrayify(
        updateContactPointAction.potentialAction
      )[0].instrument.text.includes(token.value)
    );

    assert.equal(updateContactPointAction.result.email, updatedEmail);
    assert.equal(
      updateContactPointAction.result.verificationStatus,
      'UnverifiedVerificationStatus'
    );

    // now we verify the email
    const verifiedContactPoint = await librarian.validateContactPointEmail(
      updateContactPointAction.result,
      Object.assign({}, token, {
        instrumentOf: getId(updateContactPointAction)
      }),
      { store }
    );

    // console.log(require('util').inspect(verifiedContactPoint, { depth: null }));

    assert.equal(
      verifiedContactPoint.verificationStatus,
      'VerifiedVerificationStatus'
    );
  });
});
