import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions,
  CONTACT_POINT_EDITORIAL_OFFICE
} from '../src';

describe('AssignContactPointAction', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();

    const createOrganizationAction = await librarian.post(
      {
        '@type': 'CreateOrganizationAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        result: {
          '@id': `org:${uuid.v4()}`,
          '@type': 'Organization'
        }
      },
      { acl: user }
    );

    organization = createOrganizationAction.result;

    const createPeriodicalAction = await librarian.post(
      {
        '@type': 'CreatePeriodicalAction',
        actionStatus: 'CompletedActionStatus',
        agent: {
          '@type': 'ContributorRole',
          roleName: 'editor',
          agent: getId(user)
        },
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true }
          ),
          editor: {
            roleName: 'editor',
            editor: getId(user)
          }
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;
  });

  it('should assign a contactPoint to a Periodical editor', async () => {
    const contactPoint = arrayify(user.contactPoint).find(
      contactPoint =>
        contactPoint.contactType === CONTACT_POINT_EDITORIAL_OFFICE
    );

    const assignContactPointAction = await librarian.post(
      {
        '@type': 'AssignContactPointAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        recipient: getId(arrayify(periodical.editor)[0]),
        object: getId(contactPoint)
      },
      { acl: user }
    );

    // console.log(
    //  require('util').inspect(assignContactPointAction, { depth: null })
    // );

    assert(
      arrayify(
        arrayify(assignContactPointAction.result.editor)[0].roleContactPoint
      ).some(_contactPoint => getId(_contactPoint) === getId(contactPoint))
    );
  });
});
