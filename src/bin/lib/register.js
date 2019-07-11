import uuid from 'uuid';
import { arrayify } from '@scipe/jsonld';
import { Librarian, createId } from '../../';

export default function register(
  { username, password, email, role },
  config,
  callback
) {
  const librarian = new Librarian(config);
  const user = {
    '@id': `user:${username}`,
    email: email || `success+${uuid.v4()}@simulator.amazonses.com`
  };
  if (role) {
    user.memberOf = arrayify(role).map(str => `acl:${str}`);
  }

  const tokenId = createId('token')['@id'];

  librarian.post(
    {
      '@type': 'RegisterAction',
      actionStatus: 'ActiveActionStatus',
      agent: user,
      instrument: {
        '@type': 'Password',
        value: password
      }
    },
    { tokenId, strict: false },
    (err, activeRegisterAction) => {
      if (err) return callback(err);
      librarian.post(
        Object.assign({}, activeRegisterAction, {
          actionStatus: 'CompletedActionStatus',
          instrument: {
            '@id': tokenId,
            '@type': 'Token',
            tokenType: 'registrationToken'
          }
        }),
        { strict: false },
        callback
      );
    }
  );
}
