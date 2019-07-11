import uuid from 'uuid';
import { arrayify } from '@scipe/jsonld';

// !! use createAuthorGuidelines instead, this will be removed on the next version
export default function createStyleGuide(opts = {}) {
  const id = opts['@id'] || opts.id || `_:${uuid.v4()}`;

  const styleGuide = {
    '@id': id,
    '@type': 'ScholarlyStyleGuide'
  };

  if (opts.sections || opts.addDefaultSections) {
    styleGuide.potentialAction = [
      {
        '@type': 'UpdateAction',
        object: {
          '@type': 'ScholarlyArticleTemplate',
          hasPart: opts.sections
            ? arrayify(opts.sections)
            : [
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Abstract',
                  description:
                    "A brief summary, the purpose of which is to help the reader quickly ascertain the publication's purpose.",
                  isBasedOn: 'ds3:Abstract'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Impact statement',
                  description:
                    'Briefly summarizes, in lay terms, the impact of the work ("So what?",  "Who cares?" etc.).',
                  isBasedOn: 'ds3:ImpactStatement'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Introduction',
                  description:
                    'An initial description which states the purpose and goals of the following writing, and typically includes background information on the research topic and a review of related work in the area.'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Materials and Methods',
                  description:
                    'A description documenting the specialized materials and/or methods used in the work described.'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Results',
                  description:
                    'The report of the specific findings of an investigation, given without discussion or conclusion being drawn.'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Discussion',
                  description:
                    'An interpretation and discussion of the results obtained and an analysis of their significance, in support of conclusions.'
                },
                {
                  '@id': `_:${uuid.v4()}`,
                  name: 'Bibliography',
                  description:
                    'A list of items each representing a reference to another publication',
                  isBasedOn: 'ds3:Citations'
                }
              ]
        },
        targetCollection: {
          targetCollection: id,
          hasSelector: {
            '@type': 'NodeSelector',
            nodeId: 'ds3:SectionsAndHeadings'
          }
        }
      }
    ];
  }

  return styleGuide;
}
