import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId } from '../src';

describe('CreatePublicationTypeAction', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical;
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
          hasDigitalDocumentPermission: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'editor'
            }
          },
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
  });

  it('should create a PublicationTypeAction', async () => {
    const createPublicationTypeAction = await librarian.post(
      {
        '@type': 'CreatePublicationTypeAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          name: 'Research article',
          objectSpecification: {
            '@type': 'Graph',
            mainEntity: {
              '@type': 'ScholarlyArticle',
              'description-input': {
                '@type': 'PropertyValueSpecification',
                valueRequired: true,
                valueMaxlength: 100
              }
            }
          }
        }
      },
      { acl: user }
    );

    // console.log(
    //   require('util').inspect(createPublicationTypeAction, { depth: null })
    // );

    assert(
      createPublicationTypeAction.result.objectSpecification['@graph'],
      'objectSpecification has been flattened'
    );

    assert.equal(
      createPublicationTypeAction.result['@type'],
      'PublicationType'
    );
  });
});
