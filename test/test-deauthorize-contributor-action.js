import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  getAgentId,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '../src/';

describe('DeauthorizeContributorAction', function() {
  this.timeout(40000);

  let librarian, user, contributors, organization, periodical;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [user, ...contributors] = await Promise.all([
      registerUser(),
      registerUser(),
      registerUser(),
      registerUser()
    ]);

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
          editor: [
            {
              roleName: 'editor',
              editor: getId(user)
            }
          ],
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true }
          )
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;

    // Add contributors
    for (const contributor of contributors) {
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
    }
  });

  describe('DeauthorizeContributorAction for Periodicals', () => {
    it('should deauthorize a contributor', async () => {
      const producer = arrayify(periodical.producer).find(
        role => getAgentId(role) === getId(contributors[0])
      );

      const deauthorizeContributorAction = await librarian.post(
        {
          '@type': 'DeauthorizeContributorAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: getId(producer),
          object: getId(periodical)
        },
        { acl: user }
      );

      // console.log(
      //   require('util').inspect(deauthorizeContributorAction, { depth: null })
      // );
      assert.equal(
        deauthorizeContributorAction.actionStatus,
        'CompletedActionStatus'
      );

      // the producer was terminated
      const terminatedProducer = arrayify(
        deauthorizeContributorAction.result.producer
      ).find(role => getId(role) === getId(producer));
      assert(terminatedProducer.endDate);

      // all the producers are still there (we just end roles, we do not remove them)
      assert.equal(
        arrayify(deauthorizeContributorAction.result.producer).length,
        contributors.length
      );
    });

    it('should deauthorize a user', async () => {
      const contributor = contributors[1];

      const deauthorizeContributorAction = await librarian.post(
        {
          '@type': 'DeauthorizeContributorAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: getId(contributor),
          object: getId(periodical)
        },
        { acl: user }
      );

      // console.log(
      //   require('util').inspect(deauthorizeContributorAction, { depth: null })
      // );
      assert.equal(
        deauthorizeContributorAction.actionStatus,
        'CompletedActionStatus'
      );

      // The user was terminated
      assert(
        arrayify(deauthorizeContributorAction.result.producer)
          .filter(role => getAgentId(role) === getId(contributor))
          .every(role => role.endDate)
      );

      // all the producers are still there (we just end roles, we do not remove them)
      assert.equal(
        arrayify(deauthorizeContributorAction.result.producer).length,
        contributors.length
      );
    });
  });
});
