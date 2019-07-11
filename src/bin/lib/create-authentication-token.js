import { getId } from '@scipe/jsonld';
import { Librarian } from '../../';

export default function createAuthenticationToken(
  { username, password, proxyUserId },
  config,
  callback
) {
  const librarian = new Librarian(config);
  const user = {
    '@id': `user:${username}`,
    password: password
  };

  librarian.post(
    {
      '@type': 'CreateAuthenticationTokenAction',
      actionStatus: 'CompletedActionStatus',
      agent: getId(user),
      object: proxyUserId
    },
    { acl: user },
    callback
  );
}
