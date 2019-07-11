import assert from 'assert';
import { getId, arrayify } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '../src/';

describe('ApplyAction', function() {
  this.timeout(40000);

  let librarian, user, applicant, rejectedApplicant, organization, periodical;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    [user, applicant, rejectedApplicant] = await Promise.all(
      ['accepter', 'applicant', 'rejectedApplicant'].map(id => {
        return registerUser();
      })
    );

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
            editor: user
          },
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true, publicReadPermission: true }
          )
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;
  });

  it('should issue an ApplyAction and allow an editor to accept it', async () => {
    const applyAction = await librarian.post(
      {
        '@type': 'ApplyAction',
        agent: {
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          agent: getId(applicant)
        },
        actionStatus: 'ActiveActionStatus',
        object: getId(periodical)
      },
      { acl: applicant }
    );

    assert(applyAction);

    // the editor accepts the application
    const acceptAction = await librarian.post(
      {
        '@type': 'AcceptAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        object: getId(applyAction)
      },
      { acl: user }
    );

    // console.log(require('util').inspect(acceptAction, { depth: null }));

    // check that reviewer was added to the journal
    assert.equal(
      getId(arrayify(acceptAction.result.result.reviewer)[0].reviewer),
      getId(applicant)
    );
  });

  it('should issue an ApplyAction and allow an editor to reject it', async () => {
    const applyAction = await librarian.post(
      {
        '@type': 'ApplyAction',
        agent: {
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          agent: getId(rejectedApplicant)
        },
        actionStatus: 'ActiveActionStatus',
        object: getId(periodical)
      },
      { acl: rejectedApplicant }
    );

    assert(applyAction);

    // the editor reject the application
    const rejectAction = await librarian.post(
      {
        '@type': 'RejectAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        object: getId(applyAction)
      },
      { acl: user }
    );

    // console.log(require('util').inspect(rejectAction, { depth: null }));

    assert.equal(rejectAction.result.actionStatus, 'CompletedActionStatus');
  });

  it('should issue an ApplyAction and allow an editor to delete it', async () => {
    const applyAction = await librarian.post(
      {
        '@type': 'ApplyAction',
        agent: {
          '@type': 'ContributorRole',
          roleName: 'reviewer',
          agent: getId(rejectedApplicant)
        },
        actionStatus: 'ActiveActionStatus',
        object: getId(periodical)
      },
      { acl: rejectedApplicant }
    );

    assert(applyAction);

    const list = await librarian.delete(getId(applyAction), { acl: user });
    // console.log(require('util').inspect(list, { depth: null }));

    const deleted = list.itemListElement[0].item;
    assert(deleted._deleted && getId(deleted) === getId(applyAction));
  });
});
