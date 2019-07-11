import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ASSET_LOGO,
  CSS_VARIABLE_ACCENT_COLOR
} from '../src/';

describe('UpdateAction: Periodical update', function() {
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
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          hasDigitalDocumentPermission: {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: user['@id']
          }
        }
      },
      { acl: user }
    );
    // console.log(require('util').inspect(updateAction, { depth: null }));
    periodical = createPeriodicalAction.result;
  });

  it('should update a periodical through an UpdateAction', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        ifMatch: periodical._rev,
        object: {
          name: 'my journal'
        },
        targetCollection: getId(periodical)
      },
      { acl: user }
    );
    // console.log(require('util').inspect(updateAction, { depth: null }));

    periodical = updateAction.result;

    assert.equal(periodical.name, 'my journal');
  });

  it('should update a periodical through an UpdateAction with a TargetNode', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        ifMatch: periodical._rev,
        object: {
          '@type': 'Image',
          name: ASSET_LOGO
        },
        targetCollection: {
          '@type': 'TargetRole',
          hasSelector: {
            '@type': 'NodeSelector',
            selectedProperty: 'logo'
          },
          targetCollection: getId(periodical)
        }
      },
      { acl: user }
    );

    // console.log(require('util').inspect(updateAction, { depth: null }));
    periodical = updateAction.result;
    assert.equal(periodical.logo['@type'], 'Image');
  });

  it('should add a new style to a periodical through an UpdateAction with a TargetNode', async () => {
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        actionStatus: 'CompletedActionStatus',
        agent: {
          roleName: 'author',
          agent: user['@id']
        },
        ifMatch: periodical._rev,
        object: {
          '@type': 'CssVariable',
          name: CSS_VARIABLE_ACCENT_COLOR,
          value: 'blue'
        },
        targetCollection: {
          '@type': 'TargetRole',
          hasSelector: {
            '@type': 'NodeSelector',
            selectedProperty: 'style'
          },
          targetCollection: getId(periodical)
        }
      },
      { acl: user }
    );
    // console.log(require('util').inspect(updateAction, { depth: null }));

    periodical = updateAction.result;
    assert(
      periodical.style['@id'].startsWith('node:'),
      'an style @id has been added'
    );
  });
});
