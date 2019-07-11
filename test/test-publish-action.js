import assert from 'assert';
import { arrayify, getId, unrole } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import { Librarian, createId, getScopeId, ALL_AUDIENCES } from '../src/';

describe('PublishAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    organization,
    periodical,
    graph,
    createReleaseAction,
    publishAction,
    defaultCreateGraphAction,
    release;
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
        agent: getId(user),
        object: getId(organization),
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          author: {
            '@type': 'ContributorRole',
            roleName: 'author',
            author: getId(user)
          },
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

    defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          mainEntity: '_:article',
          author: {
            roleName: 'author',
            author: getId(user)
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
      { acl: user, skipPayments: true }
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
      { acl: user }
    );

    release = createReleaseAction.result;

    publishAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'PublishAction'
    );

    // check that the public version was set at instantiation
    assert.equal(publishAction.result.version, '0.0.0');

    const datePublished = new Date().toISOString();

    publishAction = await librarian.post(
      Object.assign({}, publishAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.editor)[0]),
        result: {
          datePublished,
          slug: uuid.v4()
        }
      }),
      { acl: user }
    );
  });

  it('should publish a graph and flagged public actions', async () => {
    // check that pre-release (0.0.0-0) was turned into release number
    const publicRelease = publishAction.result;
    assert.equal(publicRelease.version, '0.0.0');
    assert(getId(publicRelease).endsWith('?version=0.0.0'));

    // check that publicRelease roles have been terminated
    assert(
      arrayify(publicRelease.author).every(
        role => role.endDate === publishAction.endTime
      )
    );

    // check that public audience was added to the publishAction
    assert(
      arrayify(publishAction.participant).some(role => {
        const unroled = unrole(role, 'participant');
        return (
          unroled &&
          unroled.audienceType === 'public' &&
          role.startDate === publicRelease.datePublished
        );
      })
    );

    // check that the release is still there (the public release is a new release and not a replacement)
    const fetchedRelease = await librarian.get(getId(release), {
      acl: false
    });
    assert.equal(fetchedRelease.version, release.version);

    // check that the release was published (as we published the associated CreateReleaseAction)
    assert(
      fetchedRelease.hasDigitalDocumentPermission.some(
        permission =>
          permission.permissionType === 'ReadPermission' &&
          permission.grantee &&
          permission.grantee.audienceType === 'public'
      )
    );

    // check that the graph.datePublished has been synced and released publicly
    const liveGraph = await librarian.get(getScopeId(graph), { acl: false });
    assert.equal(publicRelease.datePublished, liveGraph.datePublished);
    // check that live graph roles have been terminated
    assert(
      arrayify(liveGraph.author).every(
        role => role.endDate === publishAction.endTime
      )
    );

    assert(
      liveGraph.hasDigitalDocumentPermission.some(
        permission =>
          permission.permissionType === 'ReadPermission' &&
          permission.grantee &&
          permission.grantee.audienceType === 'public'
      )
    );

    // check that the create release action and  publishAction have been published
    [createReleaseAction, publishAction] = await Promise.all([
      librarian.get(getId(createReleaseAction), { acl: false }),
      librarian.get(getId(publishAction), { acl: false })
    ]);

    assert(
      createReleaseAction.participant.some(
        participant =>
          participant.participant &&
          participant.participant.audienceType === 'public'
      )
    );
    assert(
      publishAction.participant.some(
        participant =>
          participant.participant &&
          participant.participant.audienceType === 'public'
      )
    );

    // console.log(
    //   require('util').inspect(
    //     { createReleaseAction, publishAction },
    //     { depth: null }
    //   )
    // );

    // check that public release is flagged as latest and that `release` now has a versioned _id
    const updatedRelease = await librarian.get(getId(release), {
      acl: user
    });

    assert(publicRelease._id.endsWith('::release::latest'));
    assert(updatedRelease._id.endsWith('::release::0.0.0-0'));
  });

  it('should not allow to re-use an already allocated slug', async () => {
    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(user),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          mainEntity: '_:article',
          author: {
            roleName: 'author',
            author: getId(user)
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
      { acl: user, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    const graph = createGraphAction.result;

    const detaultCreateReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    await librarian.post(
      Object.assign({}, detaultCreateReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: user }
    );

    let defaultPublishAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'PublishAction'
    );

    await assert.rejects(
      librarian.post(
        Object.assign({}, defaultPublishAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          result: {
            slug: publishAction.result.slug // create a conflict
          }
        }),
        { acl: user }
      ),
      {
        code: 423,
        message: /locked/
      }
    );
  });
});
