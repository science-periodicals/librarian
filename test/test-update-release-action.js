import assert from 'assert';
import path from 'path';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE
} from '../src/';

describe('Release updateAction / uploadAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    author,
    organization,
    periodical,
    graph,
    createReleaseAction,
    release;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();
    author = await registerUser();

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
        agent: getId(user),
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: getId(user)
          },
          producer: {
            '@type': 'ContributorRole',
            roleName: 'producer',
            producer: getId(user)
          },
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
                getId(user),
                { '@type': 'Audience', audienceType: 'editor' },
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
            agent: { '@type': 'Role', roleName: 'author' },
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: ALL_AUDIENCES
              },
              potentialAction: [
                {
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: [
                    {
                      '@id': '_:createReleaseAction',
                      '@type': 'CreateReleaseAction',
                      agent: {
                        '@type': 'ContributorRole',
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
                      ],
                      result: {
                        '@type': 'Graph',
                        version: 'preminor',
                        potentialAction: {
                          '@id': '_:publishAction',
                          '@type': 'PublishAction',
                          publishActionInstanceOf: [
                            '_:createReleaseAction',
                            '_:publishAction'
                          ],
                          publishIdentityOf: [
                            {
                              '@type': 'Audience',
                              audienceType: 'author'
                            }
                          ],
                          agent: {
                            '@type': 'ContributorRole',
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          }
                        }
                      }
                    }
                  ]
                }
              ]
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
        agent: getId(author),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          mainEntity: '_:article',
          author: {
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(arrayify(periodical.editor)[0]),
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'ScholarlyArticle'
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    graph = createGraphAction.result;

    createReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    assert(createReleaseAction);

    createReleaseAction = await librarian.post(
      Object.assign({}, createReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    let publishAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'PublishAction'
    );

    publishAction = await librarian.post(
      Object.assign({}, publishAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        result: {
          datePublished: new Date().toISOString(),
          slug: uuid.v4()
        }
      }),
      { acl: user }
    );

    release = publishAction.result;
  });

  it('should update a release banner', async () => {
    // first we update the release to get a style @id
    const updateAction = await librarian.post(
      {
        '@type': 'UpdateAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        object: {
          style: {
            '@type': 'CssVariable',
            name: CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE
          }
        },
        targetCollection: getId(release)
      },
      { acl: user }
    );

    //console.log(require('util').inspect(updateAction, { depth: null }));
    const style = updateAction.result.style;
    assert(getId(style));

    const filePath = path.join(__dirname, 'fixtures/image.jpg');
    const uploadAction = await librarian.post(
      {
        '@type': 'UploadAction',
        actionStatus: 'ActiveActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        object: {
          '@type': 'ImageObject',
          fileFormat: 'image/jpeg',
          name: path.basename(filePath),
          contentUrl: `file://${filePath}`,
          encodesCreativeWork: getId(style),
          isNodeOf: getId(release)
        },
        autoUpdate: true
      },
      { acl: user, webify: false, mode: 'document' }
    );

    // console.log(require('util').inspect(uploadAction, { depth: null }));
    assert.equal(
      uploadAction.potentialAction.result.style.encoding['@type'],
      'ImageObject'
    );
  });
});
