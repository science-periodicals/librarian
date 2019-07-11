import assert from 'assert';
import createError from '@scipe/create-error';
import { getId, unprefix } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createDb, createId } from '../src';

describe('UpdatePasswordAction', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser();
  });

  it('should update the user password', async () => {
    const action = await librarian.post(
      {
        '@type': 'UpdatePasswordAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        instrument: {
          '@type': 'Password',
          value: user.password
        },
        object: {
          '@type': 'Password',
          value: 'new-password'
        },
        targetCollection: getId(user)
      },
      { acl: user }
    );

    // console.log(require('util').inspect(action, { depth: null }));
    assert(action.endTime);

    // try to get profile with the new password
    const db = createDb(librarian.config);
    const profile = await new Promise((resolve, reject) => {
      db.get(
        {
          url: `/${encodeURIComponent(createId('profile', getId(user))._id)}`,
          json: true,
          auth: {
            username: unprefix(getId(user)),
            password: 'new-password'
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
    // delete the organization so that the stripe account is deleted
    return librarian.close();
  });
});
