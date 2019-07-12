import assert from 'assert';
import {
  getLocationIdentifier,
  validateAndSetupWorkflowSpecification,
  ALL_AUDIENCES
} from '../src';

describe('workflow-utils', function() {
  describe('getLocationIdentifier', () => {
    it('should return unique identifier', () => {
      const props = [
        'actionStatus',
        'description',
        'expectedDuration',
        'encoding',
        'releaseNotes',
        'programmingLanguage',
        'isBasedOn',
        'hasPart',
        'comment',
        'text',
        'distribution',
        'result',
        'object',
        'revisionType',
        'resultReason',
        //'result.slug',
        'slug', // shortcut (context should never matter as `slug` is not an action property)
        //'result.datePublished',
        'datePublished', // shortcut (context should never matter as `datePublished` is not an action property)
        'requestedPrice',
        'instrument',
        'question',
        'annotation',
        'citation',
        'about',
        'license',
        'alternateName',
        'caption',
        'funder',
        'headline',
        'detailedDescription',
        'answer',
        // !! context may matter for `parentItem`
        'parentItem',
        'answer.parentItem',
        'resultReview',
        // !! context may matter for `reviewRating`
        'reviewRating',
        'resultReview.reviewRating',
        // !! context may matter for `reviewBody`
        'reviewBody',
        'resultReview.reviewBody',
        'potentialAction'
      ];

      const identifiers = props.map(p =>
        getLocationIdentifier('DeclareAction', p)
      );
      assert.equal(identifiers.length, new Set(identifiers).size);
    });
  });

  describe('validateAndSetupWorkflowSpecification', async () => {
    it('should purge when there are no orphan stages', async () => {
      const workflowSpecification = {
        '@type': 'WorkflowSpecification',
        expectedDuration: 'P60D',
        potentialAction: {
          '@type': 'CreateGraphAction',
          result: {
            '@graph': [
              {
                '@type': 'Graph',
                potentialAction: {
                  '@id': '_:submission',
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: [
                    {
                      '@id': '_:reviewAction',
                      '@type': 'ReviewAction',
                      actionStatus: 'ActiveActionStatus',
                      agent: {
                        roleName: 'reviewer'
                      },
                      participant: {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      }
                    }
                  ]
                }
              },
              // we add an orphan node the should be purged
              {
                '@id': '_:orphan',
                '@type': 'DeclareAction',
                agent: {
                  roleName: 'author'
                },
                participant: ALL_AUDIENCES
              }
            ]
          }
        }
      };

      const valid = await validateAndSetupWorkflowSpecification(
        workflowSpecification,
        { '@id': 'journal:journalId', '@type': 'Periodical' }
      );

      // console.log(require('util').inspect(valid, { depth: null }));
      const nodes = valid.potentialAction.result['@graph'];
      assert(!nodes.some(node => node['@type'] === 'DeclareAction'));
    });

    it('should not purge orphan stages', async () => {
      const workflowSpecification = {
        '@type': 'WorkflowSpecification',
        expectedDuration: 'P60D',
        potentialAction: {
          '@type': 'CreateGraphAction',
          result: {
            '@graph': [
              {
                '@type': 'Graph',
                potentialAction: {
                  '@id': '_:submission',
                  '@type': 'StartWorkflowStageAction',
                  participant: ALL_AUDIENCES,
                  result: [
                    {
                      '@id': '_:reviewAction',
                      '@type': 'ReviewAction',
                      actionStatus: 'ActiveActionStatus',
                      agent: {
                        roleName: 'reviewer'
                      },
                      participant: {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      }
                    }
                  ]
                }
              },
              // we add an orphan stage linked to itself as linking to self can
              // cause bug in the orphan stage detection algorithm
              {
                '@id': '_:orphan',
                '@type': 'StartWorkflowStageAction',
                name: 'orphan',
                participant: ALL_AUDIENCES,
                result: [
                  {
                    '@id': '_:assessAction',
                    '@type': 'AssessAction',
                    agent: {
                      roleName: 'editor'
                    },
                    participant: [
                      {
                        '@type': 'Audience',
                        audienceType: 'editor'
                      },
                      {
                        '@type': 'Audience',
                        audienceType: 'reviewer'
                      }
                    ],
                    potentialResult: ['_:orphan']
                  }
                ]
              }
            ]
          }
        }
      };

      // TODO
      const valid = await validateAndSetupWorkflowSpecification(
        workflowSpecification,
        { '@id': 'journal:journalId', '@type': 'Periodical' }
      );

      // console.log(require('util').inspect(valid, { depth: null }));
      const nodes = valid.potentialAction.result['@graph'];
      assert(nodes.some(node => node.name === 'orphan'));
    });
  });
});
