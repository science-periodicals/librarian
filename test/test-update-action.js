import assert from 'assert';
import uuid from 'uuid';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

// See also:
// - test-update-graph-action.js
// - test-update-release-action.js
// - etc.
// for other for type specific updates

describe('UpdateAction', function() {
  this.timeout(40000);

  describe('Profile update', function() {
    let librarian, user;
    before(async () => {
      librarian = new Librarian({ skipPayments: true });

      user = await registerUser();
    });

    it('should update a profile through an UpdateAction', async () => {
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          object: {
            children: {
              '@type': 'Person',
              name: 'Napoleon'
            }
          },
          ifMatch: user._rev,
          targetCollection: user['@id']
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));

      assert(updateAction.result.children);
    });
  });

  describe('Organization update', function() {
    let librarian, user, organization;
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
            '@type': 'Organization',
            name: 'my org'
          }
        },
        { acl: user }
      );

      organization = createOrganizationAction.result;
    });

    it('should update the organization name', async () => {
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          object: {
            name: 'updated name'
          },
          ifMatch: organization._rev,
          targetCollection: getId(organization)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));
      assert.equal(updateAction.result.name, 'updated name');
    });
  });

  describe('Role updates (Periodical)', function() {
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
            editor: {
              '@type': 'ContributorRole',
              roleName: 'editor',
              name: 'editor in chief',
              editor: user['@id']
            },
            hasDigitalDocumentPermission: {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: user['@id']
            }
          }
        },
        { acl: user }
      );

      periodical = createPeriodicalAction.result;
    });

    it('should update a periodical role', async () => {
      const role = arrayify(periodical.editor)[0];

      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          ifMatch: periodical._rev,
          object: {
            name: 'editorial office'
          },
          targetCollection: getId(role)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));
      assert.equal(updateAction.result.name, 'editorial office');
    });
  });

  describe('Update WorkflowSpecification', () => {
    let librarian, user, organization, periodical, workflowSpecification;

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
            editor: {
              '@type': 'ContributorRole',
              roleName: 'editor',
              name: 'editor in chief',
              editor: user['@id']
            },
            hasDigitalDocumentPermission: {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: user['@id']
            }
          }
        },
        { acl: user }
      );

      periodical = createPeriodicalAction.result;

      const createWorkflowSpecificationAction = await librarian.post(
        {
          '@type': 'CreateWorkflowSpecificationAction',
          agent: getId(user),
          object: getId(periodical),
          result: {
            '@type': 'WorkflowSpecification',
            expectedDuration: 'P60D',
            potentialAction: {
              '@type': 'CreateGraphAction',
              result: {
                '@type': 'Graph',
                potentialAction: {
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: {
                    '@type': 'DeclareAction',
                    agent: { roleName: 'author' },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'author'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        { acl: user }
      );

      workflowSpecification = createWorkflowSpecificationAction.result;
    });

    it('should update a workflow specification', async () => {
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          ifMatch: workflowSpecification._rev,
          object: {
            name: 'updated name',
            potentialAction: {
              '@type': 'CreateGraphAction',
              result: {
                '@type': 'Graph',
                potentialAction: {
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: {
                    name: 'Declare me',
                    '@type': 'DeclareAction',
                    agent: { roleName: 'author' },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'author'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      }
                    ]
                  }
                }
              }
            }
          },
          targetCollection: getId(workflowSpecification)
        },
        { acl: user }
      );

      // console.log(require('util').inspect(updateAction, { depth: null }));
      assert.equal(updateAction.result.name, 'updated name');
      assert(
        arrayify(updateAction.result.potentialAction)[0].result['@graph'].some(
          node => node.name === 'Declare me'
        ),
        'Graph was flattened and action updated'
      );
    });
  });

  describe('Issue update', function() {
    let librarian, user, organization, periodical, issue;

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

      const createPublicationIssueAction = await librarian.post(
        {
          '@type': 'CreatePublicationIssueAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          object: periodical['@id'],
          result: {
            '@type': 'PublicationIssue'
          }
        },
        { acl: user }
      );
      issue = createPublicationIssueAction.result;
    });

    it('should update an issue through an UpdateAction', async () => {
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          ifMatch: issue._rev,
          object: {
            name: 'my issue'
          },
          targetCollection: getId(issue)
        },
        { acl: user }
      );
      // console.log(require('util').inspect(updateAction, { depth: null }));

      issue = updateAction.result;

      assert.equal(issue.name, 'my issue');
    });
  });

  describe('Special Issue update', function() {
    let librarian, user, organization, periodical, issue;

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

      const createSpecialPublicationIssueAction = await librarian.post(
        {
          '@type': 'CreateSpecialPublicationIssueAction',
          actionStatus: 'CompletedActionStatus',
          agent: user['@id'],
          object: periodical['@id'],
          result: {
            '@id': createId('issue', 'hello', periodical['@id'])['@id'],
            '@type': 'SpecialPublicationIssue'
          }
        },
        { acl: user }
      );
      issue = createSpecialPublicationIssueAction.result;
    });

    it('should update a special issue through an UpdateAction', async () => {
      const updateAction = await librarian.post(
        {
          '@type': 'UpdateAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(user),
          ifMatch: issue._rev,
          object: {
            name: 'my issue'
          },
          targetCollection: getId(issue)
        },
        { acl: user }
      );
      // console.log(require('util').inspect(updateAction, { depth: null }));

      issue = updateAction.result;

      assert.equal(issue.name, 'my issue');
    });
  });
});
