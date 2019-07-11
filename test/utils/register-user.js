import uuid from 'uuid';
import { Librarian, createId } from '../../src';

export default async function registerUser(user) {
  user = Object.assign(
    {
      '@id': `user:${uuid.v4()}`,
      name: 'peter',
      email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
    },
    user
  );

  let librarian = new Librarian();

  const tokenId = createId('token')['@id'];
  const password = uuid.v4();

  const activeRegisterAction = await librarian.post(
    {
      '@type': 'RegisterAction',
      actionStatus: 'ActiveActionStatus',
      agent: user,
      instrument: {
        '@type': 'Password',
        value: password
      }
    },
    { tokenId, strict: false }
  );

  const completedRegisterAction = await librarian.post(
    Object.assign({}, activeRegisterAction, {
      actionStatus: 'CompletedActionStatus',
      instrument: {
        '@id': tokenId,
        '@type': 'Token',
        tokenType: 'registrationToken'
      }
    }),
    { strict: false }
  );

  return Object.assign({}, completedRegisterAction.result, {
    password,
    email: user.email // add back for convenience
  });
}
