import { getId } from '@scipe/jsonld';
import uuid from 'uuid';
import { Librarian } from '../../';

export default function createPeriodical(
  { username, password, journalName, organizationId },
  config,
  callback
) {
  const librarian = new Librarian(config);
  const user = {
    '@id': `user:${username}`,
    password: password
  };

  librarian.post(
    {
      '@type': 'CreatePeriodicalAction',
      actionStatus: 'CompletedActionStatus',
      agent: getId(user),
      object: organizationId,
      result: {
        '@type': 'Periodical',
        editor: {
          '@id': '_:editor',
          '@type': 'ContributorRole',
          roleName: 'editor',
          editor: getId(user)
        },
        name: journalName || `Journal ${uuid.v4()}`,
        url: `https://${uuid.v4()}.sci.pe`,
        hasDigitalDocumentPermission: [
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'AdminPermission',
            grantee: getId(user)
          },
          {
            '@type': 'DigitalDocumentPermission',
            permissionType: 'ReadPermission',
            grantee: {
              '@type': 'Audience',
              audienceType: 'public'
            }
          }
        ],

        potentialAction: {
          '@type': 'CreateGraphAction',
          name: 'Default workflow',
          actionStatus: 'PotentialActionStatus',
          expectedDuration: 'P7D', // used to specify the overall deadline of the submission
          participant: '_:editor', // the user is the triage editor of its own journal (can be changed later)
          result: {
            '@type': 'Graph',
            hasDigitalDocumentPermission: [
              // permission that do not require scope
              'ReadPermission',
              'WritePermission',
              'AssessPermission',
              'CreateReleasePermission',
              'CreateOfferPermission'
            ]
              .map(permissionType => {
                return {
                  '@type': 'DigitalDocumentPermission',
                  permissionType: permissionType,
                  grantee: ['editor', 'author', 'reviewer', 'producer'].map(
                    audienceType => {
                      return {
                        '@type': 'Audience',
                        audienceType: audienceType
                      };
                    }
                  )
                };
              })
              .concat(
                [
                  // permission requiring scopes
                  'ReadReviewPermission',
                  'WriteReviewPermission',
                  'ReadCommentPermission',
                  'WriteCommentPermission',
                  'CommunicatePermission',
                  'InvitePermission',
                  'ViewIdentityPermission',
                  'AssignPermission'
                ].map(permissionType => {
                  return {
                    '@type': 'DigitalDocumentPermission',
                    permissionType: permissionType,
                    grantee: ['editor', 'author', 'reviewer', 'producer'].map(
                      audienceType => {
                        return {
                          '@type': 'Audience',
                          audienceType: audienceType
                        };
                      }
                    ),
                    permissionScope: [
                      'editor',
                      'author',
                      'reviewer',
                      'producer'
                    ].map(audienceType => {
                      return {
                        '@type': 'Audience',
                        audienceType: audienceType
                      };
                    })
                  };
                })
              )
              .concat({
                '@type': 'DigitalDocumentPermission',
                permissionType: 'AdminPermission',
                grantee: getId(user)
              }),

            potentialAction: {
              '@type': 'CreateWorkflowStageAction',
              name: 'Submission stage',
              result: {
                '@type': 'CreateReleaseAction',
                agent: {
                  '@type': 'Role',
                  roleName: 'author'
                },
                name: 'Upload files',
                expectedDuration: 'P1D',
                result: {
                  '@type': 'Graph',
                  potentialAction: [
                    {
                      '@type': 'AssessAction',
                      expectedDuration: 'P2D',
                      agent: {
                        '@type': 'Role',
                        roleName: 'editor'
                      },
                      name: 'Assess manuscript',
                      result: [
                        {
                          '@type': 'RejectAction',
                          agent: {
                            '@type': 'Role',
                            roleName: 'editor'
                          }
                        },
                        {
                          '@type': 'CreateWorkflowStageAction',
                          name: 'Production stage',
                          result: {
                            '@type': 'CreateReleaseAction',
                            expectedDuration: 'P7D',
                            agent: {
                              '@type': 'Role',
                              roleName: 'producer'
                            },
                            name: 'Publish',
                            result: {
                              '@type': 'Graph',
                              hasDigitalDocumentPermission: {
                                '@type': 'DigitalDocumentPermission',
                                grantee: {
                                  '@type': 'Audience',
                                  audienceType: 'public'
                                }
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
          }
        }
      }
    },
    { acl: user },
    (err, createPeriodicalAction) => {
      if (err) return callback(err);
      callback(null, createPeriodicalAction);
    }
  );
}
