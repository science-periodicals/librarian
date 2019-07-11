import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '../src/';

describe('AuthorizeContributorAction', function() {
  this.timeout(40000);

  let librarian, user, contributor, organization, periodical;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [user, contributor] = await Promise.all([registerUser(), registerUser()]);

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

    organization = createOrganizationAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        agent: user['@id'],
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          author: {
            roleName: 'author',
            author: user
          },
          editor: {
            roleName: 'editor',
            editor: getId(user)
          },
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true }
          )
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;

    // Add contributor
    const inviteProducerAction = await librarian.post(
      {
        '@type': 'InviteAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        recipient: {
          roleName: 'producer',
          recipient: getId(contributor)
        },
        object: getId(periodical)
      },
      { acl: user }
    );

    const acceptInviteProducerActionAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(contributor),
        object: getId(inviteProducerAction)
      },
      { acl: contributor }
    );

    periodical = acceptInviteProducerActionAction.result.result;
  });

  describe('AuthorizeContributorAction for Periodicals', () => {
    it('should authorize a contributor', async () => {
      const authorizeContributorAction = await librarian.post(
        {
          '@type': 'AuthorizeContributorAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            '@type': 'ContributorRole',
            roleName: 'producer',
            name: 'pic',
            recipient: getId(contributor)
          },
          object: getId(periodical)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(authorizeContributorAction, { depth: null }));
      assert.equal(
        authorizeContributorAction.actionStatus,
        'CompletedActionStatus'
      );

      assert(
        arrayify(authorizeContributorAction.result.producer).find(
          role => role.name === 'pic'
        )
      );
    });
  });
});
