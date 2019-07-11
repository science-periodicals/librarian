import assert from 'assert';
import crypto from 'crypto';
import createError from '@scipe/create-error';
import { getId, arrayify, unprefix } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createDb, createId } from '../src';

describe('ResetPasswordAction', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser();
  });

  it('should reset the user password', async () => {
    // Note: we post that not logged in to verify that ACL is all good
    const action = await librarian.post({
      '@type': 'ResetPasswordAction',
      agent: getId(user),
      actionStatus: 'CompletedActionStatus',
      object: getId(user),
      potentialAction: {
        '@type': 'InformAction',
        recipient: getId(user),
        actionStatus: 'CompletedActionStatus',
        instrument: {
          '@type': 'EmailMessage',
          text: {
            '@type': 'sa:ejs',
            '@value':
              '<%= getId(passwordResetToken) %>;<%= getId(passwordResetToken.value) %>'
          }
        }
      }
    });

    // console.log(require('util').inspect(action, { depth: null }));
    assert(action.endTime);
    const [tokenId, tokenValue] = arrayify(
      action.potentialAction
    )[0].instrument.text.split(';');

    // Update the password with the reset token
    const newPassword = crypto.randomBytes(8).toString('hex');
    const updatePasswordAction = await librarian.post(
      {
        '@type': 'UpdatePasswordAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        instrument: {
          '@id': tokenId,
          '@type': 'Token',
          tokenType: 'passwordResetToken',
          value: tokenValue
        },
        object: {
          '@type': 'Password',
          value: newPassword
        },
        targetCollection: getId(user)
      },
      { acl: user }
    );

    // try to get profile with the new password
    const db = createDb(librarian.config);
    const profile = await new Promise((resolve, reject) => {
      db.get(
        {
          url: `/${encodeURIComponent(createId('profile', getId(user))._id)}`,
          json: true,
          auth: {
            username: unprefix(getId(user)),
            password: newPassword
          }
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return reject(err);
          }
          resolve(body);
        }
      );
    });
    assert(profile);
  });

  after(async () => {
    return librarian.close();
  });
});
