import assert from 'assert';
import path from 'path';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, ALL_AUDIENCES } from '../src/';

describe('UploadAction', function() {
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
                    },
                    {
                      '@type': 'Audience',
                      audienceType: 'producer'
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
              '@type': 'ScholarlyArticle'
            }
          ]
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;
  });

  it('should handle an UploadAction and set the right audience', async () => {
    const encodingId = createId('node', null, graph)['@id'];
    const createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    const resource = graph['@graph'].find(
      node => node['@type'] === 'ScholarlyArticle'
    );

    const uploadAction = await librarian.post(
      {
        '@type': 'UploadAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(user),
        instrumentOf: getId(createReleaseAction), // needed so that we can test the added audience
        object: {
          '@id': encodingId,
          '@type': 'DataDownload',
          contentUrl: `file://${path.join(
            __dirname,
            'fixtures',
            'data-csv.csv'
          )}`,
          fileFormat: 'text/csv',
          encodesCreativeWork: getId(resource),
          isNodeOf: getId(graph)
        }
      },
      { acl: user }
    );

    // console.log(require('util').inspect(uploadAction, { depth: null }));
    assert.equal(uploadAction.actionStatus, 'CompletedActionStatus');
    assert.equal(getId(uploadAction.result), encodingId);

    // check that right audience was added
    assert(
      !uploadAction.participant.some(participant => {
        const unroled = unrole(participant, 'participant');
        return unroled && unroled.audienceType === 'editor';
      }) &&
        uploadAction.participant.some(participant => {
          const unroled = unrole(participant, 'participant');
          return unroled && unroled.audienceType === 'author';
        }) &&
        uploadAction.participant.some(participant => {
          const unroled = unrole(participant, 'participant');
          return unroled && unroled.audienceType === 'producer';
        })
    );
  });
});
