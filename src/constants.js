// NOTE: we hard code the parrallel host 10.211.55.2
// NOTE: we use https://ngrok.com/ for tunnels for local devs the URL is
// TODO use an env var or smtg...
export const RE_LOCAL_HOST_OR_DEV = /127\.0\.0\.1|10\.211\.55\.2|localhost|nightly\.sci\.pe|ngrok\.io/;

export const SA_DOI_PREFIX = '10.29016';

// identifiers
export const PRE_SUBMISSION_COMMENT = 'pre-submission-comment'; // used to set @id of journal comment
export const JOURNAL_COMMENT_IDENTIFIERS_SET = new Set([
  PRE_SUBMISSION_COMMENT
]);

export const CONTACT_POINT_ADMINISTRATION = 'administration'; // all email send by sci.pe will be sent to this email
// those email will be public and not directly used by sci.pe
export const CONTACT_POINT_EDITORIAL_OFFICE = 'editorial office';
export const CONTACT_POINT_GENERAL_INQUIRY = 'general inquiry';

export const ORGANIZATION_ADMIN_ROLE_NAME = 'administrator';

export const EMAIL_MESSAGE_SENDER = 'notifications@sci.pe';
export const SCIPE_URL = 'https://sci.pe';

export const CONTRIBUTOR_PROPS = [
  'editor',
  'producer',
  'contributor',
  'author',
  'reviewer'
];

// For convenience, we copy a subset of the role prop for actions. We only keep immutable props to avoid data to fall out of sync
export const COPIED_ROLE_PROPS = [
  '@id',
  '@type',
  'name',
  'name-input',
  'roleName',
  'roleContactPoint'
];

export const WEBIFY_ACTION_TYPES = new Set([
  'DocumentProcessingAction',
  'ImageProcessingAction',
  'AudioVideoProcessingAction'
]);

// possible values for `service.serviceType`
export const TYPESETTING_SERVICE_TYPE = 'typesetting'; // `potentialService` of `CreateReleaseAction`
export const DOI_REGISTRATION_SERVICE_TYPE = 'DOI registration'; // `addOnService` of `PublishAction`
export const PLAGIARISM_DETECTION_SERVICE_TYPE = 'plagiarism detection'; // `addOnService` of `CreateReleaseAction`
export const INDEXING_SERVICE_TYPE = 'indexing'; // `potentialService` of `IndexingAction`

export const AUTHOR_SERVICE_ACTION_TYPES = new Set(['TypesettingAction']);

// only publish action remove the pre-release and bump to plain release
export const RELEASE_TYPES = new Set([
  'premajor',
  'preminor',
  'prepatch',
  'prerelease'
]);

export const PUBLIC_ROLES = new Set([
  'acl:user',
  'acl:admin',
  'acl:typesetter',
  'acl:readOnlyUser'
]);

export const PERMISSION_TYPES = new Set([
  'CreateGraphPermission',
  'ReadPermission',
  'WritePermission',
  'AdminPermissin',
  'InvitePermission',
  'ViewIdentityPermission'
]);

export const ACTION_PERMISSION_TYPES = new Set([
  'ViewActionPermission',
  'PerformActionPermission',
  'DeleteActionPermission',
  'CancelActionPermission',
  'AssignActionPermission',
  'RescheduleActionPermission' // set expectedDuration
]);

export const ALL_AUDIENCES = [
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
];

// TODO delete (see getDefaultGraphDigitalDocumentPermissions utils instead)
export const DEFAULT_GRAPH_DIGITAL_DOCUMENT_PERMISSIONS = [
  // permission that do not require scope
  'ReadPermission',
  'WritePermission',
  'AdminPermission'
]
  .map(permissionType => {
    return {
      '@type': 'DigitalDocumentPermission',
      permissionType,
      grantee: (permissionType === 'AdminPermission'
        ? ['editor', 'producer']
        : ['editor', 'author', 'reviewer', 'producer']
      ).map(audienceType => {
        return {
          '@type': 'Audience',
          audienceType
        };
      })
    };
  })
  .concat(
    [
      // permission requiring scopes
      'ViewIdentityPermission'
    ].map(permissionType => {
      return {
        '@type': 'DigitalDocumentPermission',
        permissionType: permissionType,
        grantee: ALL_AUDIENCES,
        permissionScope: ALL_AUDIENCES
      };
    })
  );

// permissions currently not documented or exposed
export const EXPERIMENTAL_GRAPH_PERMISSIONS = [
  {
    '@type': 'DigitalDocumentPermission',
    permissionType: 'InvitePermission',
    grantee: {
      '@type': 'Audience',
      audienceType: 'author'
    },
    permissionScope: [
      {
        '@type': 'Audience',
        audienceType: 'author'
      }
    ]
  },
  {
    '@type': 'DigitalDocumentPermission',
    permissionType: 'InvitePermission',
    grantee: [
      {
        '@type': 'Audience',
        audienceType: 'editor'
      },
      {
        '@type': 'Audience',
        audienceType: 'producer'
      }
    ],
    permissionScope: [
      // given that we don't list author on the journal document we don't let
      // editor or producer invite then as this would create issue with blinding
      // when editors or producers cannot see the identity of authors
      {
        '@type': 'Audience',
        audienceType: 'editor'
      },
      {
        '@type': 'Audience',
        audienceType: 'producer'
      },
      {
        '@type': 'Audience',
        audienceType: 'reviewer'
      }
    ]
  }
];

export const DEFAULT_CREATE_WORKFLOW_STAGE_ACTION = {
  '@type': 'StartWorkflowStageAction',
  actionStatus: 'PotentialActionStatus',
  name: 'Submission stage',
  participant: ALL_AUDIENCES,
  result: {
    '@type': 'CreateReleaseAction',
    actionStatus: 'ActiveActionStatus',
    agent: { '@type': 'ContributorRole', roleName: 'author' },
    participant: ALL_AUDIENCES,
    name: 'Upload files',
    expectedDuration: 'P3D',
    result: {
      '@type': 'Graph',
      potentialAction: {
        '@id': '_:assessActionId',
        '@type': 'AssessAction',
        actionStatus: 'ActiveActionStatus',
        expectedDuration: 'P4D',
        agent: { '@type': 'ContributorRole', roleName: 'editor' },
        participant: [
          {
            '@type': 'Audience',
            audienceType: 'editor'
          },
          {
            '@type': 'Audience',
            audienceType: 'producer'
          }
        ],
        name: 'Assess manuscript',
        potentialResult: [
          {
            '@id': '_:rejectAction',
            '@type': 'RejectAction',
            agent: { '@type': 'ContributorRole', roleName: 'editor' },
            participant: ALL_AUDIENCES
          },
          {
            '@id': '_:productionStage',
            '@type': 'StartWorkflowStageAction',
            actionStatus: 'PotentialActionStatus',
            name: 'Production stage',
            alternateName: 'Accept',
            participant: ALL_AUDIENCES,
            result: {
              '@type': 'PublishAction',
              actionStatus: 'ActiveActionStatus',
              expectedDuration: 'P4D',
              agent: { '@type': 'ContributorRole', roleName: 'editor' },
              name: 'Publish',
              participant: ALL_AUDIENCES
            }
          }
        ],
        potentialAction: [
          {
            '@type': 'AuthorizeAction',
            completeOn: 'OnObjectCompletedActionStatus',
            actionStatus: 'PotentialActionStatus',
            recipient: [
              {
                '@type': 'Audience',
                audienceType: 'author'
              },
              {
                '@type': 'Audience',
                audienceType: 'reviewer'
              }
            ]
          }
        ]
      }
    }
  }
};

export const DEFAULT_SINGLE_STAGE_CREATE_WORKFLOW_STAGE_ACTION = {
  '@type': 'StartWorkflowStageAction',
  actionStatus: 'PotentialActionStatus',
  name: 'Submission and production stage',
  participant: ALL_AUDIENCES,
  result: {
    '@type': 'CreateReleaseAction',
    actionStatus: 'ActiveActionStatus',
    agent: { '@type': 'ContributorRole', roleName: 'author' },
    participant: ALL_AUDIENCES,
    name: 'Upload files',
    expectedDuration: 'P3D',
    releaseRequirement: 'ProductionReleaseRequirement',
    result: {
      '@type': 'Graph',
      potentialAction: {
        '@type': 'PublishAction',
        actionStatus: 'ActiveActionStatus',
        expectedDuration: 'P4D',
        agent: { '@type': 'ContributorRole', roleName: 'editor' },
        name: 'Publish',
        participant: ALL_AUDIENCES
      }
    }
  }
};

export const DEFAULT_PEER_REVIEW_TYPES = {
  singleBlind: {
    name: 'Single blind peer review',
    permissions: [
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ],
        permissionScope: ALL_AUDIENCES
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [
          { '@type': 'Audience', audienceType: 'author' },
          { '@type': 'Audience', audienceType: 'reviewer' }
        ],
        permissionScope: [
          { '@type': 'Audience', audienceType: 'author' },
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ]
      }
    ]
  },

  doubleBlind: {
    name: 'Double blind peer review',
    permissions: [
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ],
        permissionScope: ALL_AUDIENCES
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: { '@type': 'Audience', audienceType: 'author' },
        permissionScope: [
          { '@type': 'Audience', audienceType: 'author' },
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: { '@type': 'Audience', audienceType: 'reviewer' },
        permissionScope: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ]
      }
    ]
  },

  tripleBlind: {
    name: 'Triple blind peer review',
    permissions: [
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [{ '@type': 'Audience', audienceType: 'editor' }],
        permissionScope: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [{ '@type': 'Audience', audienceType: 'producer' }],
        permissionScope: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' },
          { '@type': 'Audience', audienceType: 'author' } // we need to allow the producer to view the identity of authors so that typesetting can be done by producers (they need to typeset names)
        ]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: { '@type': 'Audience', audienceType: 'author' },
        permissionScope: [{ '@type': 'Audience', audienceType: 'author' }]
      }
    ]
  },

  open: {
    name: 'Open peer review',
    permissions: [
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: ALL_AUDIENCES,
        permissionScope: ALL_AUDIENCES
      }
    ]
  },

  custom: {
    name: 'Custom peer review',
    // permissions that are different from open, single, double and triple blind
    // but respecting the "sane" behavior (author can see other authors etc.)
    permissions: [
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: { '@type': 'Audience', audienceType: 'author' },
        permissionScope: [{ '@type': 'Audience', audienceType: 'author' }]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: { '@type': 'Audience', audienceType: 'reviewer' },
        permissionScope: [{ '@type': 'Audience', audienceType: 'reviewer' }]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [{ '@type': 'Audience', audienceType: 'editor' }],
        permissionScope: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' }
        ]
      },
      {
        '@type': 'DigitalDocumentPermission',
        permissionType: 'ViewIdentityPermission',
        grantee: [{ '@type': 'Audience', audienceType: 'producer' }],
        permissionScope: [
          { '@type': 'Audience', audienceType: 'editor' },
          { '@type': 'Audience', audienceType: 'producer' },
          { '@type': 'Audience', audienceType: 'author' } // we need to allow the producer to view the identity of authors so that typesetting can be done by producers (they need to typeset names)
        ]
      }
    ]
  }
};

// CSS style for article, journal, issue... styles
export const CSS_VARIABLE_ACCENT_COLOR = '--accent-color';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR = '--journal-badge-color';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR2 = '--journal-badge-color2';

export const CSS_VARIABLE_ACCENT_COLOR_DARK = '--accent-color-dark';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR_DARK =
  '--journal-badge-color-dark';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR2_DARK =
  '--journal-badge-color2-dark';

export const CSS_VARIABLE_ACCENT_COLOR_ALT = '--accent-color-alt';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR_ALT = '--journal-badge-color-alt';
export const CSS_VARIABLE_JOURNAL_BADGE_COLOR2_ALT =
  '--journal-badge-color2-alt';

export const CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE =
  '--large-banner-background-image';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR = '--large-banner-text-color';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR =
  '--large-banner-text-shadow-color';

export const CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE_DARK =
  '--large-banner-background-image-dark';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR_DARK =
  '--large-banner-text-color-dark';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR_DARK =
  '--large-banner-text-shadow-color-dark';

export const CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE_ALT =
  '--large-banner-background-image-alt';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR_ALT =
  '--large-banner-text-color-alt';
export const CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR_ALT =
  '--large-banner-text-shadow-color-alt';

export const CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE =
  '--medium-banner-background-image';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR =
  '--medium-banner-text-color';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR =
  '--medium-banner-text-shadow-color';

export const CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_DARK =
  '--medium-banner-background-image-dark';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR_DARK =
  '--medium-banner-text-color-dark';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR_DARK =
  '--medium-banner-text-shadow-color-dark';

export const CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_ALT =
  '--medium-banner-background-image-alt';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR_ALT =
  '--medium-banner-text-color-alt';
export const CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR_ALT =
  '--medium-banner-text-shadow-color-alt';

export const CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE =
  '--small-banner-background-image';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR = '--small-banner-text-color';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR =
  '--small-banner-text-shadow-color';

export const CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE_DARK =
  '--small-banner-background-image-dark';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR_DARK =
  '--small-banner-text-color-dark';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR_DARK =
  '--small-banner-text-shadow-color-dark';

export const CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE_ALT =
  '--small-banner-background-image-alt';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR_ALT =
  '--small-banner-text-color-alt';
export const CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR_ALT =
  '--small-banner-text-shadow-color-alt';

export const CSS_VARIABLE_NAMES_SET = new Set([
  CSS_VARIABLE_ACCENT_COLOR,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR2,

  CSS_VARIABLE_ACCENT_COLOR_DARK,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR_DARK,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR2_DARK,

  CSS_VARIABLE_ACCENT_COLOR_ALT,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR_ALT,
  CSS_VARIABLE_JOURNAL_BADGE_COLOR2_ALT,

  CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE,
  CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR,
  CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR,

  CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE_DARK,
  CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR_DARK,
  CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR_DARK,

  CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE_ALT,
  CSS_VARIABLE_LARGE_BANNER_TEXT_COLOR_ALT,
  CSS_VARIABLE_LARGE_BANNER_TEXT_SHADOW_COLOR_ALT,

  CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR,

  CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_DARK,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR_DARK,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR_DARK,

  CSS_VARIABLE_MEDIUM_BANNER_BACKGROUND_IMAGE_ALT,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_COLOR_ALT,
  CSS_VARIABLE_MEDIUM_BANNER_TEXT_SHADOW_COLOR_ALT,

  CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE,
  CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR,
  CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR,

  CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE_DARK,
  CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR_DARK,
  CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR_DARK,

  CSS_VARIABLE_SMALL_BANNER_BACKGROUND_IMAGE_ALT,
  CSS_VARIABLE_SMALL_BANNER_TEXT_COLOR_ALT,
  CSS_VARIABLE_SMALL_BANNER_TEXT_SHADOW_COLOR_ALT
]);

// Asset types
export const ASSET_LOGO = 'logo';
export const ASSET_LOGO_DARK = 'logo-dark';
export const ASSET_LOGO_ALT = 'logo-alt';

export const ASSET_IMAGE = 'image';
export const ASSET_IMAGE_DARK = 'image-dark';
export const ASSET_IMAGE_ALT = 'image-alt';

export const ASSET_VIDEO = 'video';
export const ASSET_VIDEO_DARK = 'video-dark';
export const ASSET_VIDEO_ALT = 'video-alt';

export const ASSET_AUDIO = 'audio';
export const ASSET_AUDIO_DARK = 'audio-dark';
export const ASSET_AUDIO_ALT = 'audio-alt';

export const ASSET_LOGO_NAMES_SET = new Set([
  ASSET_LOGO,
  ASSET_LOGO_DARK,
  ASSET_LOGO_ALT
]);

export const ASSET_IMAGE_NAMES_SET = new Set([
  ASSET_IMAGE,
  ASSET_IMAGE_DARK,
  ASSET_IMAGE_ALT
]);

export const ASSET_VIDEO_NAMES_SET = new Set([
  ASSET_VIDEO,
  ASSET_VIDEO_DARK,
  ASSET_VIDEO_ALT
]);

export const ASSET_AUDIO_NAMES_SET = new Set([
  ASSET_AUDIO,
  ASSET_AUDIO_DARK,
  ASSET_AUDIO_ALT
]);

// Plans
export const SCIPE_FREE_OFFER_ID = 'offer:scipe-free';
export const SCIPE_EXPLORER_OFFER_ID = 'offer:scipe-explorer';
export const SCIPE_VOYAGER_OFFER_ID = 'offer:scipe-voyager';

export const SCIPE_FREE_SUBMISSION_STRIPE_PLAN_ID = 'scipe-free-submission';
export const SCIPE_FREE_PUBLICATION_STRIPE_PLAN_ID = 'scipe-free-publication';

export const SCIPE_EXPLORER_SUBMISSION_STRIPE_PLAN_ID =
  'scipe-explorer-submission';
export const SCIPE_EXPLORER_PUBLICATION_STRIPE_PLAN_ID =
  'scipe-explorer-publication';

export const SCIPE_VOYAGER_SUBMISSION_STRIPE_PLAN_ID =
  'scipe-voyager-submission';
export const SCIPE_VOYAGER_PUBLICATION_STRIPE_PLAN_ID =
  'scipe-voyager-publication';

export const SCIPE_FREE_ACTIVATION_PRICE_USD = 0;
export const SCIPE_EXPLORER_ACTIVATION_PRICE_USD = 1000;
export const SCIPE_VOYAGER_ACTIVATION_PRICE_USD = 0;

export const SCIPE_FREE_SUBMMISSION_PRICE_USD = 0;
export const SCIPE_FREE_PUBLICATION_PRICE_USD = 0;
export const SCIPE_FREE_TAXE_FRACTION = 0;

export const SCIPE_EXPLORER_SUBMMISSION_PRICE_USD = 10;
export const SCIPE_EXPLORER_PUBLICATION_PRICE_USD = 89;
export const SCIPE_EXPLORER_TAXE_FRACTION = 30 / 100;

export const SCIPE_VOYAGER_SUBMMISSION_PRICE_USD = 0;
export const SCIPE_VOYAGER_PUBLICATION_PRICE_USD = 0;
export const SCIPE_VOYAGER_TAXE_FRACTION = 0;

export const BLINDED_PROPS = [
  'creator',
  'author',
  'contributor',
  'reviewer',
  'editor',
  'producer'
];

export const PDF = 'application/pdf';

export const EDITABLE_OFFLINE_TYPES = new Set([
  'CommentAction',
  'CreateReleaseAction',
  'TypesettingAction',
  'DeclareAction',
  'ReviewAction',
  'PayAction',
  'AssessAction',
  'PublishAction'
]);

// error codes
export const ERROR_CODE_POTENTIAL_INFORM_ACTION = 599;
export const ERROR_CODE_POTENTIAL_INFORM_ACTION_FATAL = 598;
export const ERROR_CODE_TRIGGERED_ACTION = 589;
