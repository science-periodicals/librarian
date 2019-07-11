import SchemaOrg from 'schema.org';
import ontology from '@scipe/ontology';

const schema = new SchemaOrg({
  '@context': ontology['@context'],
  '@graph': ontology.defines
});

export default schema;
