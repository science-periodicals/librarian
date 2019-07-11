import assert from 'assert';
import fs from 'fs';
import path from 'path';
import once from 'once';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

// Note: test to upload for releases is done in test-update-release-action.js

describe('Upload', function() {
  this.timeout(40000);

  let librarian, user, organization, periodical, graph;
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
          name: 'my journal',
          hasDigitalDocumentPermission: [
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'CreateGraphPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'user'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'ReadPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'public'
              }
            },
            {
              '@type': 'DigitalDocumentPermission',
              permissionType: 'AdminPermission',
              grantee: [
                user['@id'],
                { '@type': 'Audience', audienceType: 'editor' },
                { '@type': 'Audience', audienceType: 'author' },
                { '@type': 'Audience', audienceType: 'reviewer' },
                { '@type': 'Audience', audienceType: 'producer' }
              ]
            }
          ]
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
              hasDigitalDocumentPermission: [
                'editor',
                'reviewer',
                'author',
                'producer'
              ].map(audienceType => {
                return {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: 'AdminPermission',
                  grantee: {
                    '@type': 'Audience',
                    audienceType
                  }
                };
              }),
              potentialAction: {
                '@type': 'StartWorkflowStageAction',
                participant: ALL_AUDIENCES,
                result: {
                  '@type': 'CreateReleaseAction',
                  actionStatus: 'ActiveActionStatus',
                  agent: {
                    roleName: 'author'
                  },
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

    const workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        result: {
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(user)
          },
          mainEntity: '_:article',
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'Dataset'
            }
          ]
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;
  });

  it('should upload a file', done => {
    done = once(done);
    const createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    const s = fs.createReadStream(
      path.join(__dirname, 'fixtures', 'data-csv.csv')
    );
    s.on('error', err => {
      done(err);
    });

    const resourceId = getId(
      graph['@graph'].find(node => node['@type'] === 'Dataset')
    );

    librarian.upload(
      s,
      {
        acl: user,
        fileFormat: 'text/csv',
        context: getId(createReleaseAction),
        resource: resourceId,
        name: 'data-csv.csv'
      },
      (err, uploadAction) => {
        if (err) return done(err);
        // console.log(require('util').inspect(uploadAction, { depth: null }));

        // object was properly set (needed for couchdb views)
        assert.equal(
          getId(uploadAction.object.encodesCreativeWork),
          resourceId
        );
        assert.equal(uploadAction.object.isNodeOf, getId(graph));
        // result was properly set
        assert.equal(
          getId(uploadAction.result.encodesCreativeWork),
          resourceId
        );
        assert.equal(uploadAction.result.isNodeOf, getId(graph));

        assert.equal(uploadAction.actionStatus, 'CompletedActionStatus');
        assert.equal(uploadAction.result['@type'], 'DataDownload');
        // check that audience was set based on the one of the CreateReleaseAction
        assert(
          arrayify(uploadAction.participant).some(
            participant =>
              unrole(participant, 'participant').audienceType === 'author'
          )
        );
        done();
      }
    );
  });
});
