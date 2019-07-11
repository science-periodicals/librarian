import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '../src';

describe('ArchiveAction', function() {
  this.timeout(40000);

  describe('archive publication type', () => {
    let librarian, user, organization, periodical, publicationType;
    before(async () => {
      librarian = new Librarian({ skipPayments: true });

      user = await registerUser();

      // Create an organization
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
          agent: getId(user),
          object: getId(organization),
          result: {
            '@id': createId('journal', uuid.v4())['@id'],
            '@type': 'Periodical',
            hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
              user
            ),
            editor: {
              '@type': 'ContributorRole',
              roleName: 'editor',
              editor: getId(user)
            }
          }
        },
        { acl: user }
      );

      periodical = createPeriodicalAction.result;

      const createPublicationTypeAction = await librarian.post(
        {
          '@type': 'CreatePublicationTypeAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          object: getId(periodical),
          result: {
            name: 'Research article'
          }
        },
        { acl: user }
      );

      publicationType = createPublicationTypeAction.result;
    });

    it('should archive a PublicationType', async () => {
      const archiveAction = await librarian.post(
        {
          '@type': 'ArchiveAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          object: getId(publicationType)
        },
        { acl: user }
      );

      assert.equal(
        archiveAction.result.publicationTypeStatus,
        'ArchivedPublicationTypeStatus'
      );
    });
  });
});
