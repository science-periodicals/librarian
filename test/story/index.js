import path from 'path';
import uuid from 'uuid';
import { unprefix } from '@scipe/jsonld';
import {
  createId,
  CONTACT_POINT_EDITORIAL_OFFICE,
  createAuthorGuidelines
} from '../../src';
import createWorkflowSpecification from './create-workflow-specification';

const TYPESETTING_OFFER_ID = createId('node')['@id'];

const EDITOR1_ID = createId('user', uuid.v4())['@id'];
const EDITOR2_ID = createId('user', uuid.v4())['@id'];
const AUTHOR1_ID = createId('user', uuid.v4())['@id'];
const AUTHOR2_ID = createId('user', uuid.v4())['@id'];
const REVIEWER1_ID = createId('user', uuid.v4())['@id'];
const REVIEWER2_ID = createId('user', uuid.v4())['@id'];
const PRODUCER_ID = createId('user', uuid.v4())['@id'];
const ORG_ID = createId('org', uuid.v4())['@id'];

const JOURNAL_ID = createId('journal', uuid.v4())['@id'];
const PUBLICATION_TYPE_ID = createId('type', uuid.v4(), JOURNAL_ID)['@id'];
const GRAPH_ID = createId('graph')['@id'];
const GRAPH_AUTHOR1_ROLE_ID = createId('role')['@id'];
const GRAPH_AUTHOR2_ROLE_ID = createId('role')['@id'];
const JOURNAL_EDITOR1_ROLE_ID = createId('role')['@id'];
const JOURNAL_EDITOR2_ROLE_ID = createId('role')['@id'];
const GRAPH_EDITOR1_ROLE_ID = createId('role')['@id'];
const GRAPH_EDITOR2_ROLE_ID = createId('role')['@id'];
const GRAPH_REVIEWER1_ROLE_ID = createId('role')['@id'];
const GRAPH_REVIEWER2_ROLE_ID = createId('role')['@id'];
const JOURNAL_PRODUCER_ROLE_ID = createId('role')['@id'];
const GRAPH_PRODUCER_ROLE_ID = createId('role')['@id'];
const UPLOAD_ACTION_ID = createId('action', null, GRAPH_ID)['@id'];
const RESOURCE_ID = createId('node', null, GRAPH_ID)['@id'];
const ENCODING_ID = createId('node', null, GRAPH_ID)['@id'];

const TYPESETTING_ACTION_ID = createId('action', null, GRAPH_ID)['@id'];

const EDITOR_TO_PRODUCER_INVITE_ACTION_ID = createId(
  'action',
  null,
  JOURNAL_ID
)['@id'];
const EDITOR_TO_EDITOR_INVITE_ACTION_ID = createId('action', null, JOURNAL_ID)[
  '@id'
];

const SPECIAL_ISSUE_ID = createId('issue', 'special-issue', JOURNAL_ID)['@id'];
const PUBLICATION_ISSUE_ID = createId('issue', 1, JOURNAL_ID)['@id']; // for publication issue the id must be a number (starting at 1)

const {
  workflowSpecification,
  WORKFLOW_SPECIFICATION_ID,
  SUBMISSION_STAGE_DECLARE_ACTION_ID,
  SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID,
  TYPESETTING_SERVICE_ID,
  SUBMISSION_STAGE_REVIEW_ACTION_ID,
  SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID,
  SUBMISSION_STAGE_ASSESS_ACTION_ID,
  PRODUCTION_STAGE_ID,
  PRODUCTION_STAGE_PUBLISH_ACTION_ID
} = createWorkflowSpecification(ORG_ID);

const story = [
  // Register users
  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': EDITOR1_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(EDITOR1_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': EDITOR2_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(EDITOR2_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': AUTHOR1_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(AUTHOR1_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': AUTHOR2_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(AUTHOR2_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': REVIEWER1_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(REVIEWER1_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': REVIEWER2_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(REVIEWER2_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  {
    '@type': 'RegisterAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': PRODUCER_ID,
      '@type': 'Person',
      email: `mailto:test+${unprefix(PRODUCER_ID)}@science.ai`
    },
    instrument: {
      '@type': 'Password',
      value: 'pass'
    },
    object: 'https://science.ai'
  },

  // Create an organization
  {
    '@type': 'CreateOrganizationAction',
    agent: EDITOR1_ID,
    actionStatus: 'CompletedActionStatus',
    result: {
      '@id': ORG_ID,
      '@type': 'Organization',
      name: 'org'
    }
  },

  // Create typesetting service
  {
    '@type': 'CreateServiceAction',
    actionStatus: 'CompletedActionStatus',
    agent: EDITOR1_ID,
    object: ORG_ID,
    result: {
      '@id': TYPESETTING_SERVICE_ID,
      '@type': 'Service',
      audience: {
        '@type': 'Audience',
        audienceType: 'user'
      },
      serviceType: 'typesetting',
      name: 'Semantic Typesetting',
      description:
        'Select this service to have your manuscript formatted and structured in order to benefit from formless submission, in-context reviews, and production quality previews. A typeset manuscript will be returned to you within 1-2 days.',
      availableChannel: {
        '@type': 'ServiceChannel',
        processingTime: 'P2D'
      },
      provider: ORG_ID,
      broker: ORG_ID,
      offers: {
        '@id': TYPESETTING_OFFER_ID,
        '@type': 'Offer',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: 0,
          priceCurrency: 'USD',
          unitText: 'submission',
          valueAddedTaxIncluded: false,
          platformFeesIncluded: false
        }
      }
    }
  },

  //activate typesetting service
  {
    '@type': 'ActivateAction',
    agent: EDITOR1_ID,
    actionStatus: 'CompletedActionStatus',
    object: TYPESETTING_SERVICE_ID
  },

  // Create journal
  {
    '@type': 'CreatePeriodicalAction',
    actionStatus: 'CompletedActionStatus',
    agent: EDITOR1_ID,
    object: ORG_ID,
    result: {
      '@id': JOURNAL_ID,
      '@type': 'Periodical',
      name: 'my journal',
      editor: {
        '@id': JOURNAL_EDITOR1_ROLE_ID,
        '@type': 'ContributorRole',
        roleName: 'editor',
        editor: EDITOR1_ID
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
          grantee: EDITOR1_ID
        }
      ]
    }
  },

  // Add a subject to the journal
  {
    '@type': 'UpdateAction',
    actionStatus: 'CompletedActionStatus',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: {
      about: [{ '@id': 'subjects:ecology', name: 'Ecology' }]
    },
    targetCollection: JOURNAL_ID
  },

  // Add a domain of expertise to the editor (we target the _role_)
  {
    '@type': 'UpdateAction',
    actionStatus: 'CompletedActionStatus',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: {
      about: [
        {
          '@id': 'subjects:earth-and-environmental-sciences',
          name: 'Earth and environmental sciences'
        }
      ]
    },
    targetCollection: JOURNAL_EDITOR1_ROLE_ID
  },

  // Allow editor to hande incoming submissions
  {
    '@type': 'AssignContactPointAction',
    actionStatus: 'CompletedActionStatus',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: createId('contact', CONTACT_POINT_EDITORIAL_OFFICE, EDITOR1_ID)[
      '@id'
    ],
    recipient: JOURNAL_EDITOR1_ROLE_ID
  },

  // Invite another editor
  {
    '@id': EDITOR_TO_EDITOR_INVITE_ACTION_ID,
    '@type': 'InviteAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'ActiveActionStatus',
    object: JOURNAL_ID,
    recipient: {
      '@id': JOURNAL_EDITOR2_ROLE_ID,
      '@type': 'ContributorRole',
      name: 'editor-in-chief',
      roleName: 'editor',
      recipient: EDITOR2_ID
    }
  },

  // editor accepts invite
  {
    '@type': 'AcceptAction',
    actionStatus: 'CompletedActionStatus',
    agent: EDITOR2_ID,
    object: EDITOR_TO_EDITOR_INVITE_ACTION_ID
  },

  // Invite a producer
  {
    '@id': EDITOR_TO_PRODUCER_INVITE_ACTION_ID,
    '@type': 'InviteAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'ActiveActionStatus',
    object: JOURNAL_ID,
    recipient: {
      '@id': JOURNAL_PRODUCER_ROLE_ID,
      '@type': 'ContributorRole',
      roleName: 'producer',
      name: 'typesetter',
      recipient: PRODUCER_ID
    }
  },

  // Producer accepts invite
  {
    '@type': 'AcceptAction',
    actionStatus: 'CompletedActionStatus',
    agent: PRODUCER_ID,
    object: EDITOR_TO_PRODUCER_INVITE_ACTION_ID
  },

  // editor create workflow specification
  {
    '@type': 'CreateWorkflowSpecificationAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: JOURNAL_ID,
    result: workflowSpecification
  },

  // editor activates workflow specification
  {
    '@type': 'ActivateAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'CompletedActionStatus',
    object: WORKFLOW_SPECIFICATION_ID
  },

  // editor create a publication type
  {
    '@type': 'CreatePublicationTypeAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    startTime: new Date().toISOString(),
    actionStatus: 'CompletedActionStatus',
    object: JOURNAL_ID,
    result: {
      '@id': PUBLICATION_TYPE_ID,
      '@type': 'PublicationType',
      name: 'Research Article',
      eligibleWorkflow: WORKFLOW_SPECIFICATION_ID,
      objectSpecification: {
        '@type': 'Graph',
        mainEntity: {
          '@type': 'ScholarlyArticle',
          hasPart: createAuthorGuidelines() // list of WebPageElement
        }
      }
    }
  },

  // editor activates publication type
  {
    '@type': 'ActivateAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'CompletedActionStatus',
    object: PUBLICATION_TYPE_ID
  },

  // Author create graph (editor 1 is the corresponding editor)
  {
    '@type': 'CreateGraphAction',
    actionStatus: 'CompletedActionStatus',
    agent: AUTHOR1_ID,
    participant: JOURNAL_EDITOR1_ROLE_ID,
    object: WORKFLOW_SPECIFICATION_ID,
    result: {
      '@id': GRAPH_ID,
      '@type': 'Graph',
      additionalType: PUBLICATION_TYPE_ID,
      editor: {
        '@id': JOURNAL_EDITOR1_ROLE_ID,
        sameAs: GRAPH_EDITOR1_ROLE_ID // will be used to create a new unique @id specific to this graph. This is useful to handle identity blinding
      },
      author: {
        '@id': GRAPH_AUTHOR1_ROLE_ID,
        '@type': 'ContributorRole',
        roleName: 'author',
        author: AUTHOR1_ID
      }
    }
  },

  // Author adds a contributor (Author 2)
  {
    '@type': 'AuthorizeContributorAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    recipient: {
      '@id': GRAPH_AUTHOR2_ROLE_ID,
      '@type': 'ContributorRole',
      roleName: 'author',
      recipient: AUTHOR2_ID
    },
    object: GRAPH_ID
  },

  // Editor 1 adds editor 2 to the Graph
  {
    '@type': 'AuthorizeContributorAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: {
      '@id': JOURNAL_EDITOR2_ROLE_ID,
      sameAs: GRAPH_EDITOR2_ROLE_ID
    },
    object: GRAPH_ID
  },

  // Author answer author questions (DeclareAction)
  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_DECLARE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0&question=0`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to declare action q1'
    }
  },

  {
    '@id': `${SUBMISSION_STAGE_DECLARE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'DeclareAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: GRAPH_ID
  },

  // Add a ScholarlyArticle
  {
    '@type': 'UpdateAction',
    actionStatus: 'CompletedActionStatus',
    mergeStrategy: 'ReconcileMergeStrategy',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    instrumentOf: `${SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    object: {
      mainEntity: RESOURCE_ID,
      '@graph': [
        {
          '@id': RESOURCE_ID,
          '@type': 'ScholarlyArticle'
        }
      ]
    },
    targetCollection: GRAPH_ID
  },

  {
    '@id': UPLOAD_ACTION_ID,
    '@type': 'UploadAction',
    actionStatus: 'ActiveActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: {
      '@id': ENCODING_ID,
      '@type': 'DocumentObject',
      fileFormat: 'application/pdf',
      name: path.basename(path.resolve(__dirname, '../fixtures/article.pdf')),
      contentUrl: `file://${path.resolve(
        __dirname,
        '../fixtures/article.pdf'
      )}`,
      encodesCreativeWork: RESOURCE_ID,
      isNodeOf: GRAPH_ID
    }
  },

  {
    '@type': 'UpdateAction',
    actionStatus: 'CompletedActionStatus',
    mergeStrategy: 'ReconcileMergeStrategy',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: UPLOAD_ACTION_ID,
    instrumentOf: `${SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    targetCollection: GRAPH_ID
  },

  // Author adds a subject to the main entity
  {
    '@type': 'UpdateAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    mergeStrategy: 'ReconcileMergeStrategy',
    instrumentOf: `${SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    object: {
      '@graph': [
        {
          '@id': RESOURCE_ID,
          about: {
            '@id': 'subjects:business-and-commerce',
            name: 'Business and commerce'
          }
        }
      ]
    },
    targetCollection: GRAPH_ID
  },

  // Author buys typesetting service
  {
    '@type': 'BuyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    instrumentOf: `${SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    object: TYPESETTING_OFFER_ID,
    result: {
      orderedItem: TYPESETTING_ACTION_ID
    }
  },

  // producer joins graph
  {
    '@type': 'JoinAction',
    actionStatus: 'CompletedActionStatus',
    agent: {
      '@id': JOURNAL_PRODUCER_ROLE_ID,
      sameAs: GRAPH_PRODUCER_ROLE_ID
    },
    object: GRAPH_ID
  },

  //editor assigns typesetting action
  {
    '@type': 'AssignAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: GRAPH_PRODUCER_ROLE_ID,
    object: TYPESETTING_ACTION_ID
  },

  // Author completes the CreateReleaseAction
  {
    '@id': `${SUBMISSION_STAGE_CREATE_RELEASE_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'CreateReleaseAction',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: GRAPH_ID,
    actionStatus: 'CompletedActionStatus'
  },

  // Editor tags the submission
  {
    '@type': 'TagAction',
    actionStatus: 'CompletedActionStatus',
    object: GRAPH_ID,
    agent: GRAPH_EDITOR1_ROLE_ID,
    result: {
      '@type': 'Tag',
      name: 'my tag'
    }
  },

  // Editor add a reviewers
  {
    '@type': 'AuthorizeContributorAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: {
      '@id': GRAPH_REVIEWER1_ROLE_ID,
      '@type': 'ContributorRole',
      roleName: 'reviewer',
      recipient: REVIEWER1_ID
    },
    object: GRAPH_ID
  },

  {
    '@type': 'AuthorizeContributorAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: {
      '@id': GRAPH_REVIEWER2_ROLE_ID,
      '@type': 'ContributorRole',
      roleName: 'reviewer',
      recipient: REVIEWER2_ID
    },
    object: GRAPH_ID
  },

  // editor assign review 1 to reviewer 1
  {
    '@type': 'AssignAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: GRAPH_REVIEWER1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`
  },

  // editor assign review 2 to reviewer 2
  {
    '@type': 'AssignAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    recipient: GRAPH_REVIEWER2_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=1`
  },

  // reviewer 1 answer questions
  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_REVIEWER1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0&question=0`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q1'
    }
  },

  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_REVIEWER1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0&question=1`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q2'
    }
  },

  // reviewer 1 fill review body and rating and mark the review as staged => ready for endorsement
  {
    '@id': `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'ReviewAction',
    actionStatus: 'StagedActionStatus',
    agent: GRAPH_REVIEWER1_ROLE_ID,
    object: `${GRAPH_ID}?version=0.0.0-0`,
    resultReview: {
      '@type': 'Review',
      reviewBody: 'review body',
      reviewRating: {
        '@type': 'Rating',
        bestRating: 5,
        ratingValue: 4,
        worstRating: 1
      }
    }
  },

  // author endorse the review
  {
    '@type': 'EndorseAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`
  },

  // reviewer 2 answer questions, fills review body and rating and mark review as staged
  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_REVIEWER2_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=1&question=0`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q1'
    }
  },

  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_REVIEWER2_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=1&question=1`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q2'
    }
  },

  {
    '@id': `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=1`,
    '@type': 'ReviewAction',
    actionStatus: 'StagedActionStatus',
    agent: GRAPH_REVIEWER2_ROLE_ID,
    object: `${GRAPH_ID}?version=0.0.0-0`,
    resultReview: {
      '@type': 'Review',
      reviewBody: 'review body',
      reviewRating: {
        '@type': 'Rating',
        bestRating: 5,
        ratingValue: 4,
        worstRating: 1
      }
    }
  },

  // author endorse the second review
  {
    '@type': 'EndorseAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_AUTHOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=1`
  },

  // editor reschedule the last review
  {
    '@type': 'ScheduleAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=2`,
    expectedDuration: 'P7D'
  },

  // editor cancels the last review
  {
    '@type': 'CancelAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=2`
  },

  //editor completes editor review
  // editor 1 answer questions
  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0&question=0`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q1'
    }
  },

  {
    '@type': 'ReplyAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0&question=1`,
    resultComment: {
      '@type': 'Answer',
      text: 'answer to q2'
    }
  },

  // editor 1 fill review body and rating and mark the review as staged => ready for endorsement
  {
    '@id': `${SUBMISSION_STAGE_EDITOR_REVIEW_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'ReviewAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${GRAPH_ID}?version=0.0.0-0`,
    resultReview: {
      '@type': 'Review',
      reviewBody: 'editor review body',
      reviewRating: {
        '@type': 'Rating',
        bestRating: 5,
        ratingValue: 4,
        worstRating: 1
      }
    }
  },

  // editor assess the graph and send it to production stage
  {
    '@id': `${SUBMISSION_STAGE_ASSESS_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'AssessAction',
    actionStatus: 'CompletedActionStatus',
    agent: GRAPH_EDITOR1_ROLE_ID,
    object: `${GRAPH_ID}?version=0.0.0-0`,
    result: {
      '@type': 'StartWorkflowStageAction',
      instanceOf: PRODUCTION_STAGE_ID
    }
  },

  // editor publish the graph
  {
    '@id': `${PRODUCTION_STAGE_PUBLISH_ACTION_ID}?graph=${unprefix(
      GRAPH_ID
    )}&instance=0`,
    '@type': 'PublishAction',
    agent: GRAPH_EDITOR1_ROLE_ID,
    actionStatus: 'CompletedActionStatus',
    object: `${GRAPH_ID}`
  },

  // editor creates a _special_ publication issue with the published article
  {
    '@type': 'CreateSpecialPublicationIssueAction',
    actionStatus: 'CompletedActionStatus',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: JOURNAL_ID,
    result: {
      '@id': SPECIAL_ISSUE_ID,
      '@type': 'SpecialPublicationIssue',
      hasPart: [`${GRAPH_ID}?version=latest`]
    }
  },

  // editor creates a publication issue
  {
    '@type': 'CreatePublicationIssueAction',
    actionStatus: 'CompletedActionStatus',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    object: JOURNAL_ID,
    result: {
      '@id': PUBLICATION_ISSUE_ID,
      '@type': 'PublicationIssue',
      datePublished: new Date(
        new Date().getTime() + 30 * 24 * 60 * 60 * 1000 // 1 month from now. Note that this must be _after_ the dateCreated of the journal. So if you use new Date().toISOString() that won't work as by the time the journal is created by librarian the date will be past that...
      ).toISOString() // convenient way to set the issue `temporalCoverage`. datePublished will be used to set the end point of the interval. The begining of the interval will be set to the end of the previous issue (if any) or the `dateCreated` of the journal (if this is the first issue)
    }
  },

  // editor mark the publication issue as a featured issue _and_ the article as featured article of the journal
  {
    '@type': 'UpdateAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'CompletedActionStatus',
    object: {
      workFeatured: [
        PUBLICATION_ISSUE_ID,
        `${GRAPH_ID}?version=latest` // graphId must be specified as _latest_ version
      ]
    },
    targetCollection: JOURNAL_ID
  },

  // editor mark the article as a featured article of the issue
  {
    '@type': 'UpdateAction',
    agent: JOURNAL_EDITOR1_ROLE_ID,
    actionStatus: 'CompletedActionStatus',
    object: {
      workFeatured: `${GRAPH_ID}?version=latest` // graphId must be specified as _latest_ version
    },
    targetCollection: PUBLICATION_ISSUE_ID
  }
];

export default story;
