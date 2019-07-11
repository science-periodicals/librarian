import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import { Librarian } from '../../';

export default function createOrg(
  {
    username,
    password,
    organizationId,
    organizationName,
    organizationEmail,
    planName
  },
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
      '@type': 'CreateOrganizationAction',
      actionStatus: 'CompletedActionStatus',
      agent: getId(user),
      result: {
        '@id': `org:${organizationId || uuid.v4()}`,
        '@type': 'Organization',
        name: organizationName
      }
    },
    { acl: user },
    (err, createOrganizationAction) => {
      if (err) return callback(err);

      callback(null, createOrganizationAction);
    }
  );
}
