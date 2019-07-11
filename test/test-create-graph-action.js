import assert from 'assert';
import uuid from 'uuid';
import { getId } from '@scipe/jsonld';
import { parseIndexableString } from '@scipe/collate';
import registerUser from './utils/register-user';
import {
  Librarian,
  createId,
  CONTACT_POINT_EDITORIAL_OFFICE,
  ALL_AUDIENCES
} from '../src/';

describe('CreateGraphAction', function() {
  this.timeout(40000);

  let librarian, user, author, periodical, organization, workflow, type;
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
              permissionType: 'AdminPermission',
              grantee: {
                '@type': 'Audience',
                audienceType: 'editor'
              }
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
          editor: {
            '@type': 'ContributorRole',
            roleName: 'editor',
            editor: user,
            roleContactPoint: {
              '@type': 'ContactPoint',
              contactType: CONTACT_POINT_EDITORIAL_OFFICE
            }
          }
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
            participant: getId(periodical.editor),
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
                  permissionType: 'ReadPermission',
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
                  agent: {
                    roleName: 'reviewer'
                  },
                  participant: {
                    '@type': 'Audience',
                    audienceType: 'editor'
                  },
                  instrument: {
                    '@type': 'Answer',
                    parentItem: {
                      '@type': 'Question',
                      text: 'Is methionine mentioned ?'
                    }
                  }
                }
              }
            }
          }
        }
      },
      { acl: user }
    );

    workflow = createWorkflowSpecificationAction.result;

    const createPublicationTypeAction = await librarian.post(
      {
        '@type': 'CreatePublicationTypeAction',
        agent: getId(user),
        actionStatus: 'CompletedActionStatus',
        object: getId(periodical),
        result: {
          '@type': 'PublicationType',
          name: 'Research article',
          eligibleWorkflow: getId(workflow),
          objectSpecification: {
            '@type': 'Graph',
            mainEntity: {
              '@type': 'ScholarlyArticle',
              'description-input': {
                '@type': 'PropertyValueSpecification',
                valueRequired: true,
                valueMaxlength: 100
              }
            }
          }
        }
      },
      { acl: user }
    );

    type = createPublicationTypeAction.result;
  });

  it('should create a graph', async () => {
    // console.log(require('util').inspect(workflow, { depth: null }));

    const defaultCreateGraphAction = workflow.potentialAction;
    const resultId = createId('graph', uuid.v4());
    const createGraphAction = await librarian.post(
      Object.assign({}, defaultCreateGraphAction, {
        actionStatus: 'CompletedActionStatus',
        agent: getId(author),
        result: {
          '@id': resultId['@id'],
          '@type': 'Graph',
          additionalType: getId(type),
          author: {
            '@type': 'ContributorRole',
            roleName: 'author',
            author: getId(author)
          },
          editor: getId(periodical.editor), // works because the editor is listed in the template
          mainEntity: '_:article',
          '@graph': [
            {
              '@id': '_:article',
              '@type': 'ScholarlyArticle',
              isNodeOf: resultId['@id'],
              hasPart: {
                '@id': '_:image',
                '@type': 'Image',
                isNodeOf: resultId['@id'],
                hasPart: {
                  '@id': '_:part1',
                  '@type': 'Image',
                  isBasedOn: '_:code',
                  isNodeOf: resultId['@id']
                }
              }
            },
            {
              '@id': '_:code',
              '@type': 'SoftwareSourceCode',
              isNodeOf: resultId['@id']
            }
          ]
        }
      }),
      { acl: author, skipPayments: true }
    );

    // console.log(require('util').inspect(createGraphAction, { depth: null }));

    // check that agent was upgraded to a role from the Graph (this is to facilitate blinding that operates on roles)
    assert(getId(createGraphAction.agent).startsWith('role:'));

    assert(
      createGraphAction['@id'] !== defaultCreateGraphAction['@id'],
      'the createGraphAction has been renamed'
    );
    const graph = createGraphAction.result;
    const [graphId] = parseIndexableString(createGraphAction._id);

    assert.equal(graph.identifier, 1);

    assert.equal(graphId, graph['@id'], 'the action id is scoped to the graph');
    assert(createGraphAction);
    assert(graph._id);
    assert.equal(graph['@type'], 'Graph');

    // check that worfklow action have identifiers
    assert(graph.potentialAction.length);
    const stage = graph.potentialAction.find(
      action => action['@type'] === 'StartWorkflowStageAction'
    );
    assert.equal(stage.identifier, '0');
    const reviewAction = graph.potentialAction.find(
      action => action['@type'] === 'ReviewAction'
    );
    assert.equal(reviewAction.identifier, '0.0');

    // check that blank nodes got relabeled
    assert(graph.mainEntity.startsWith('node:'));
    const scholarlyArticle = graph['@graph'].find(
      node => node['@type'] === 'ScholarlyArticle'
    );
    assert.equal(graph.mainEntity, scholarlyArticle['@id']);
    assert.equal(graph.publisher, organization['@id']);

    // a specific version of the workflow was saved
    assert(getId(graph.workflow).includes('?version='));

    const archivedWorkflow = await librarian.get(getId(graph.workflow), {
      acl: author
    });
    assert.equal(getId(archivedWorkflow.exampleOfWork), getId(workflow));

    // a specific version of the publication type was saved
    assert(getId(graph.additionalType).includes('?version='));

    const archivedType = await librarian.get(getId(graph.additionalType), {
      acl: author
    });
    assert.equal(getId(archivedType.exampleOfWork), getId(type));
  });
});
