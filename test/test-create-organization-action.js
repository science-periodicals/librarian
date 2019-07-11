import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian } from '../src';

describe('CreateOrganizationAction', function() {
  this.timeout(40000);

  let librarian, user;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });
    user = await registerUser();
  });

  it('should  create an organization', async () => {
    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': `org:${uuid.v4()}`,
          '@type': 'Organization',
          member: {
            '@type': 'ServiceProviderRole',
            roleName: 'producer',
            name: 'typesetter',
            member: getId(user)
          }
        }
      },
      { acl: user }
    );

    // console.log(
    //   require('util').inspect(createOrganizationAction, { depth: null })
    // );

    const org = createOrganizationAction.result;
    assert(org, 'there is an org');
    assert(org['@id'], 'org @id');
    assert.equal(org['@type'], 'Organization', 'org @type');
  });
});
