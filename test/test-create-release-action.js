import assert from 'assert';
import { arrayify, getId } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  getDefaultPeriodicalDigitalDocumentPermissions,
  getDefaultGraphDigitalDocumentPermissions
} from '../src/';

// TODO test potential action of CRA (different code branch + need to check that date was updated)

describe('CreateReleaseAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    author,
    organization,
    periodical,
    graph,
    firstCreateReleaseAction,
    secondCreateReleaseAction;

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
          hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
            user,
            { createGraphPermission: true }
          )
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
            participant: ALL_AUDIENCES,
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: getDefaultGraphDigitalDocumentPermissions(),
              potentialAction: [
                {
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: [
                    {
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
                          '@type': 'AssessAction',
                          actionStatus: 'ActiveActionStatus',
                          name: 'pre-screening',
                          agent: {
                            '@type': 'ContributorRole',
                            roleName: 'editor'
                          },
                          participant: {
                            '@type': 'Audience',
                            audienceType: 'editor'
                          },
                          potentialResult: [
                            {
                              '@type': 'StartWorkflowStageAction',
                              actionStatus: 'PotentialActionStatus',
                              participant: ALL_AUDIENCES,
                              result: {
                                '@type': 'CreateReleaseAction',
                                actionStatus: 'ActiveActionStatus',
                                agent: {
                                  '@type': 'Role',
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
                          ]
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
          author: {
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(arrayify(periodical.editor)[0]),
          '@graph': [
            {
              '@type': 'Dataset',
              name: 'data'
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    graph = createGraphAction.result;

    firstCreateReleaseAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'CreateReleaseAction'
    );

    firstCreateReleaseAction = await librarian.post(
      Object.assign({}, firstCreateReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0]),
        releaseNotes: 'release notes',
        comment: {
          '@type': 'AuthorResponseComment'
        },
        annotation: {
          '@type': 'Annotation'
        }
      }),
      { acl: author }
    );

    let assessAction = arrayify(graph.potentialAction).find(
      action => action['@type'] === 'AssessAction'
    );

    assessAction = await librarian.post(
      Object.assign({}, assessAction, {
        agent: getId(arrayify(graph.editor)[0]),
        result: getId(
          arrayify(assessAction.potentialResult).find(
            result => result['@type'] === 'StartWorkflowStageAction'
          )
        ),
        revisionType: 'MajorRevision',
        actionStatus: 'CompletedActionStatus'
      }),
      { acl: user }
    );

    secondCreateReleaseAction = assessAction.result.result.find(
      result => result['@type'] === 'CreateReleaseAction'
    );
  });

  it('should have created the first release', async () => {
    assert(firstCreateReleaseAction);

    // console.log(require('util').inspect(firstCreateReleaseAction, { depth: null }));

    assert.equal(firstCreateReleaseAction.releaseNotes, 'release notes');

    assert.equal(firstCreateReleaseAction.result['@type'], 'Graph');
    assert.equal(firstCreateReleaseAction.result.version, '0.0.0-0');

    // check that annotation got an @id
    assert(getId(firstCreateReleaseAction.annotation));

    // check that comment got an @id
    assert(getId(firstCreateReleaseAction.comment));

    // check that the @graph of the release was synced to the live graph for indexing purpose (lucene)
    const syncedGraph = await librarian.get(getId(graph), {
      acl: false
    });

    assert(
      arrayify(syncedGraph['@graph']).some(node => node['@type'] === 'Dataset')
    );

    // check identifiers
    assert.equal(firstCreateReleaseAction.result.identifier, 1);
    assert.equal(syncedGraph.identifier, 2);
  });

  it('should prevent to re-create an existing release', async () => {
    await assert.rejects(
      librarian.post(
        Object.assign({}, firstCreateReleaseAction, {
          actionStatus: 'CompletedActionStatus',
          agent: getId(arrayify(graph.author)[0])
        }),
        { acl: author }
      ),
      {
        name: 'Error'
      }
    );
  });

  it('should create a second release', async () => {
    secondCreateReleaseAction = await librarian.post(
      Object.assign({}, secondCreateReleaseAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(graph.author)[0])
      }),
      { acl: author }
    );

    assert.equal(secondCreateReleaseAction.result.version, '1.0.0-0');

    // check that second release is flagged as latest and that first now has a versioned _id
    const r2 = secondCreateReleaseAction.result;
    const r1 = await librarian.get(getId(firstCreateReleaseAction.result), {
      acl: author
    });

    assert(r2._id.endsWith('::release::latest'));
    assert(r1._id.endsWith('::release::0.0.0-0'));
  });
});
