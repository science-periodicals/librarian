import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify, reUuid, unprefix } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src/';

describe('CreatePeriodicalAction', function() {
  this.timeout(40000);

  let librarian, user, org;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': createId('org', uuid.v4())['@id'],
          '@type': 'Organization',
          name: 'org'
        }
      },
      { acl: user }
    );
    org = createOrganizationAction.result;
  });

  it('should create a periodical', async () => {
    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(org),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          hasDigitalDocumentPermission: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'public'
            }
          },
          editor: {
            '@id': '_:triageEditor',
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: getId(user),
            sameAs: '_:triageEditor'
          }
        }
      },
      { acl: user }
    );

    const periodical = createPeriodicalAction.result;

    assert(createPeriodicalAction);
    assert(periodical._id);
    assert.equal(periodical.publisher, org['@id']);

    // Test that role @id was converted to uuid etc.
    const editor = arrayify(periodical.editor)[0];
    assert(reUuid.test(unprefix(getId(editor))));
    assert(editor.startDate, 'startDate was added');
  });
});
