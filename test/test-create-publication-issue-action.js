import assert from 'assert';
import moment from 'moment';
import { arrayify, getId, unprefix } from '@scipe/jsonld';
import uuid from 'uuid';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions,
  ALL_AUDIENCES
} from '../src/';

describe('CreatePublicationIssueAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    organization,
    periodical,
    graph,
    release,
    createPublicationIssueAction;
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
            result: {
              '@type': 'Graph',
              hasDigitalDocumentPermission: {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: [
                  { '@type': 'Audience', audienceType: 'editor' },
                  { '@type': 'Audience', audienceType: 'author' },
                  { '@type': 'Audience', audienceType: 'reviewer' },
                  { '@type': 'Audience', audienceType: 'producer' }
                ]
              },
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
                          '@type': 'PublishAction',
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
        agent: getId(user),
        participant: getId(arrayify(periodical.editor)[0]),
        result: {
          '@type': 'Graph',
          author: {
            roleName: 'author',
            author: getId(user)
          },
          editor: getId(arrayify(periodical.editor)[0])
        }
      }),
      { acl: user, skipPayments: true }
    );
    // console.log(require('util').inspect(createGraphAction, { depth: null }));
    graph = createGraphAction.result;

    let createReleaseAction = arrayify(graph.potentialAction).find(
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

    createPublicationIssueAction = await librarian.post(
      {
        '@type': 'CreatePublicationIssueAction',
        actionStatus: 'CompletedActionStatus',
        agent: getId(arrayify(periodical.editor)[0]),
        object: getId(periodical),
        result: {
          '@type': 'PublicationIssue',
          temporalCoverage: `${periodical.dateCreated}/${moment(
            release.datePublished
          )
            .add(1, 'months')
            .toISOString()}`
        }
      },
      { acl: user }
    );
  });

  it('should have created an issue', async () => {
    const issue = createPublicationIssueAction.result;
    // console.log(
    //   require('util').inspect(createPublicationIssueAction, { depth: null })
    // );
    assert.equal(issue['@type'], 'PublicationIssue');
    assert.equal(issue['@id'], `issue:${unprefix(getId(periodical))}/1`);
  });

  it('should have added the issue to the release isPartOf', async () => {
    const updatedRelease = await librarian.get(release, {
      acl: user,
      potentialActions: false
    });
    // console.log(require('util').inspect(updatedRelease, { depth: null }));
    assert.equal(
      getId(updatedRelease.isPartOf),
      getId(createPublicationIssueAction.result)
    );
  });
});
