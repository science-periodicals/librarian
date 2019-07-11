import createId from '../create-id';

// TODO use SA ontology for the sameAs

/**
 * this is used to fill part of the `objectSpecification` prop (`hasPart` of a `ScholarlyArticle`) of a `PublicationType`
 */
export default function createAuthorGuidelines() {
  return [
    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Abstract',
      description:
        "A brief summary, the purpose of which is to help the reader quickly ascertain the publication's purpose.",
      sameAs: 'WPAbstract'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Impact statement',
      description:
        'Briefly summarizes, in lay terms, the impact of the work ("So what?",  "Who cares?" etc.).',
      sameAs: 'WPImpactStatement'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Introduction',
      description:
        'An initial description which states the purpose and goals of the following writing, and typically includes background information on the research topic and a review of related work in the area.',
      sameAs: 'WPIntroduction'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Materials and Methods',
      description:
        'A description documenting the specialized materials and/or methods used in the work described.',
      sameAs: 'WPMaterialsAndMethods'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Results',
      description:
        'The report of the specific findings of an investigation, given without discussion or conclusion being drawn.',
      sameAs: 'WPResults'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Discussion',
      description:
        'An interpretation and discussion of the results obtained and an analysis of their significance, in support of conclusions.',
      sameAs: 'WPDiscussion'
    },

    {
      '@id': createId('blank')['@id'],
      '@type': 'PublicationElementType',
      name: 'Bibliography',
      description:
        'A list of items each representing a reference to another publication',
      sameAs: 'WPReferenceList'
    }
  ].map(publicationElementType => {
    return {
      '@id': createId('blank')['@id'],
      '@type': 'WebPageElement',
      additionalType: publicationElementType
    };
  });
}
