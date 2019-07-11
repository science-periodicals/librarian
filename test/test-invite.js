import assert from 'assert';
import { getId, arrayify, unprefix } from '@scipe/jsonld';
import uuid from 'uuid';
import moment from 'moment';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  ALL_AUDIENCES,
  encrypt,
  getAgentId
} from '../src/';

describe('InviteAction, AcceptAction, RejectAction', function() {
  this.timeout(40000);

  let librarian,
    user,
    accepter,
    rejecter,
    accepter2,
    organization,
    periodical,
    workflowSpecification,
    graph;

  before(async () => {
    librarian = new Librarian({ skipPayments: true });

    user = await registerUser();
    accepter = await registerUser();
    accepter2 = await registerUser();
    rejecter = await registerUser();

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
        agent: user['@id'],
        actionStatus: 'CompletedActionStatus',
        object: organization['@id'],
        result: {
          '@id': createId('journal', uuid.v4())['@id'],
          '@type': 'Periodical',
          name: 'my journal',
          author: {
            roleName: 'author',
            author: user
          },
          editor: {
            roleName: 'editor',
            editor: user
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
              permissionType: 'AdminPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'editor'
              }
            }
          ].concat(
            ['reviewer', 'author', 'producer'].map(audienceType => {
              return {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ReadPermission',
                grantee: {
                  '@type': 'Audience',
                  audienceType
                }
              };
            })
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
                  '@type': 'ReviewAction',
                  expectedDuration: 'P2D',
                  agent: { '@type': 'Role', roleName: 'reviewer' },
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
                      audienceType: 'reviewer'
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
    workflowSpecification = createWorkflowSpecificationAction.result;

    const defaultCreateGraphAction = arrayify(
      workflowSpecification.potentialAction
    ).find(action => action['@type'] === 'CreateGraphAction');

    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: user['@id'],
        participant: createPeriodicalAction.result.editor[0],
        result: {
          '@type': 'Graph',
          editor: {
            roleName: 'editor',
            editor: user['@id']
          }
        }
      }),
      { acl: user, skipPayments: true }
    );

    graph = createGraphAction.result;

    // console.log(require('util').inspect(graph, { depth: null }));
  });

  describe('invites to Graphs', () => {
    it('should invite the recipient to a Graph with the purpose of performing the review action using an email, have that email reconciled, and then add him to the participant list through an AcceptAction', async () => {
      const endDate = new Date().toISOString();
      const startDate = moment(endDate)
        .subtract(1, 'month')
        .toISOString();

      const reviewAction = arrayify(graph.potentialAction).find(
        action => action['@type'] === 'ReviewAction'
      );

      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          purpose: getId(reviewAction),
          recipient: {
            roleName: 'reviewer',
            recipient: { email: accepter.email }
          },
          object: graph['@id']
        },
        { acl: user }
      );

      // console.log(require('util').inspect(inviteAction, { depth: null }));

      assert(inviteAction['@id']);
      assert(
        getId(inviteAction.recipient.recipient).startsWith('user:'),
        'email has been reconciled to an @id'
      );

      // make the recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter),
          object: inviteAction['@id']
        },
        { acl: accepter }
      );
      // console.log(require('util').inspect(acceptAction, { depth: null }));

      assert.equal(acceptAction.result.actionStatus, 'CompletedActionStatus');
      const updatedGraph = acceptAction.result.result;
      assert(
        arrayify(updatedGraph.reviewer).find(
          role => role.roleName === 'reviewer'
        )
      );

      // check that the Review action was auto-assigned
      const assignedReviewAction = await librarian.get(reviewAction, {
        acl: false
      });
      assert.equal(getAgentId(assignedReviewAction.agent), getId(accepter));
    });

    it('should invite the recipient to a Graph and have the recipient decline the invite through a RejectAction', async () => {
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          recipient: {
            roleName: 'reviewer',
            recipient: rejecter
          },
          object: graph['@id']
        },
        { acl: user }
      );

      // console.log(require('util').inspect(inviteAction, { depth: null }));

      assert(inviteAction['@id']);

      // make the recipient reject the invite
      const rejectAction = await librarian.post(
        {
          '@type': 'RejectAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(rejecter),
          object: inviteAction['@id']
        },
        { acl: rejecter }
      );
      // console.log(require('util').inspect(rejectAction, { depth: null }));

      assert.equal(rejectAction.result.actionStatus, 'CompletedActionStatus');
    });

    it('should invite someone by email and have the identity resolved when that user registers', async () => {
      const email = `mailto:${uuid.v4()}@example.com`;
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          recipient: {
            roleName: 'reviewer',
            recipient: {
              email
            }
          },
          object: graph['@id']
        },
        { acl: user }
      );

      const registree = await registerUser({
        '@id': `user:${uuid.v4()}`,
        email,
        password: uuid.v4()
      });

      // we check that the InviteAction has been reconciled
      const reconciled = await librarian.get(inviteAction, { acl: user });

      assert.equal(reconciled.recipient.recipient['@id'], registree['@id']);
    });
  });

  describe('invites to Periodicals', () => {
    it('should invite the recipient to the Periodical', async () => {
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            roleName: 'producer',
            recipient: { email: accepter.email }
          },
          object: periodical['@id']
        },
        { acl: user }
      );

      // make the recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter),
          object: inviteAction['@id']
        },
        { acl: accepter }
      );
      // console.log(require('util').inspect(acceptAction, { depth: null }));

      assert.equal(acceptAction.result.actionStatus, 'CompletedActionStatus');
      const updatedPeriodical = acceptAction.result.result;
      assert(
        arrayify(updatedPeriodical.producer).find(
          role => getAgentId(role) === getId(accepter)
        )
      );
    });
  });

  describe('invites to Organizations', () => {
    it('should invite the recipient to the Organization', async () => {
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(organization.member)[0]),
          recipient: {
            roleName: 'administrator',
            recipient: { email: accepter.email }
          },
          object: organization['@id']
        },
        { acl: user }
      );

      // make the recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter),
          object: inviteAction['@id']
        },
        { acl: accepter }
      );
      // console.log(require('util').inspect(acceptAction, { depth: null }));

      assert.equal(acceptAction.result.actionStatus, 'CompletedActionStatus');
      const updatedOrganization = acceptAction.result.result;
      assert(
        arrayify(updatedOrganization.member).find(
          role => getAgentId(role) === getId(accepter)
        )
      );
    });

    it('should reinvite a recipient who previously left', async () => {
      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(organization.member)[0]),
          recipient: {
            roleName: 'administrator',
            recipient: { email: accepter2.email }
          },
          object: organization['@id']
        },
        { acl: user }
      );

      // make the recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter2),
          object: inviteAction['@id']
        },
        { acl: accepter2 }
      );

      // accepter 2 now leaves
      const leaveAction = await librarian.post(
        {
          '@type': 'LeaveAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter2),
          object: getId(organization)
        },
        { acl: accepter2 }
      );

      // `accepter2` is not removed from the Org, instead an `endDate` is set
      // now check that we can invite him back

      const reInviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(organization.member)[0]),
          recipient: {
            roleName: 'administrator',
            recipient: { email: accepter2.email }
          },
          object: organization['@id']
        },
        { acl: user }
      );

      const reAcceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(accepter2),
          object: getId(reInviteAction)
        },
        { acl: accepter2 }
      );

      // console.log(require('util').inspect(reAcceptAction, { depth: null }));

      const updatedOrganization = reAcceptAction.result.result;

      const allAccepter2MemberRoles = arrayify(
        updatedOrganization.member
      ).filter(role => getAgentId(role) === getId(accepter2));

      assert(
        allAccepter2MemberRoles.length === 2 &&
          allAccepter2MemberRoles.some(role => role.endDate) &&
          allAccepter2MemberRoles.some(role => !role.endDate)
      );
    });
  });

  describe('anonymized invites to Graph', () => {
    let reviewer;

    before(async () => {
      // we add a reviewer to the Journal (that the editor will later invite anonymously
      reviewer = await registerUser();

      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(periodical.editor)[0]),
          recipient: {
            roleName: 'reviewer',
            recipient: getId(reviewer)
          },
          object: periodical['@id']
        },
        { acl: user }
      );

      // make the reviewer recipient accept the invite
      const acceptAction = await librarian.post(
        {
          '@type': 'AcceptAction',
          actionStatus: 'CompletedActionStatus',
          agent: getId(reviewer),
          object: inviteAction['@id']
        },
        { acl: reviewer }
      );

      periodical = acceptAction.result.result;
    });

    it('should let the editor invite an anonymous reviewer', async () => {
      const journalReviewerRole = arrayify(periodical.reviewer).find(
        role => getAgentId(role) === getId(reviewer)
      );

      const inviteAction = await librarian.post(
        {
          '@type': 'InviteAction',
          actionStatus: 'ActiveActionStatus',
          agent: getId(arrayify(graph.editor)[0]),
          recipient: {
            '@id': `anon:${encrypt(
              getId(journalReviewerRole),
              graph.encryptionKey
            )}?graph=${unprefix(getId(graph))}`, // Note the @id is typically encrypted by the API
            roleName: 'reviewer'
          },
          object: getId(graph)
        },
        { acl: user }
      );

      // Note if `anonymize` was set to `true` for librarian.post the return invite would be anonymized and safe.
      // check that the anonymized recipient was propery resolved
      assert.equal(getAgentId(inviteAction.recipient), getId(reviewer));

      // a new Graph role was created
      assert(getId(inviteAction.recipent) !== getId(journalReviewerRole));

      // console.log(require('util').inspect(inviteAction, { depth: null }));
    });
  });
});
