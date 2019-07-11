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

describe('UnassignContactPointAction', function() {
  this.timeout(40000);

  let librarian, user, contactPoint, organization, periodical;
  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();

    contactPoint = arrayify(user.contactPoint).find(
      contactPoint =>
        contactPoint.contactType === CONTACT_POINT_EDITORIAL_OFFICE
    );

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
            editor: getId(user),
            roleContactPoint: contactPoint
          }
        }
      },
      { acl: user }
    );

    periodical = createPeriodicalAction.result;
  });

  it('should unassign a contactPoint from a Periodical role', async () => {
    const unassignContactPointAction = await librarian.post(
      {
        '@type': 'UnassignContactPointAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        recipient: getId(arrayify(periodical.editor)[0]),
        object: getId(contactPoint)
      },
      { acl: user }
    );

    // console.log(
    //   require('util').inspect(unassignContactPointAction, { depth: null })
    // );

    assert(
      !arrayify(
        arrayify(unassignContactPointAction.result.editor)[0].roleContactPoint
      ).some(_contactPoint => getId(_contactPoint) === getId(contactPoint))
    );
  });
});
