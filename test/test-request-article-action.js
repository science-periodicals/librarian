import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src/';

describe('RequestArticleAction', function() {
  this.timeout(40000);

  let librarian, user, org, periodical;
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

    periodical = createPeriodicalAction.result;
  });

  it('should let the user create, update and delete a request for article', async () => {
    let rfa = await librarian.post(
      {
        '@type': 'RequestArticleAction',
        agent: getId(arrayify(periodical.editor)[0]),
        object: getId(periodical),
        actionStatus: 'ActiveActionStatus'
      },
      { acl: user }
    );
    // console.log(require('util').inspect(rfa, { depth: null }));

    assert(rfa);
    // agent is resolved
    assert.equal(rfa.agent.roleName, 'editor');

    // url was set
    assert(rfa.url);

    // update it (test if the lock behaves)
    rfa = await librarian.post(
      {
        '@type': 'RequestArticleAction',
        agent: getId(arrayify(periodical.editor)[0]),
        object: getId(periodical),
        actionStatus: 'ActiveActionStatus',
        name: 'hello'
      },
      { acl: user }
    );
    assert.equal(rfa.name, 'hello');
    // console.log(require('util').inspect(rfa, { depth: null }));

    // delete it
    const itemList = await librarian.delete(rfa, { acl: user });
    // console.log(require('util').inspect(itemList, { depth: null }));
    assert(itemList.itemListElement[0].item.dateDeleted);
  });
});
