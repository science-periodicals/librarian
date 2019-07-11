import traverse from 'traverse';
import { getId } from '@scipe/jsonld';

/**
 * Set id and take care to remap any blank node to the new value
 */
export default function setId(
  object,
  id, // an object with {'@id', _id} as created by createId()
  relabelMap = {}
) {
  if (!object || id == null) return object;
  if (typeof id === 'string') {
    id = { '@id': id };
  }

  const prevId = getId(object);
  object = Object.assign({}, object, id);

  const newId = getId(id);
  if (prevId && prevId !== newId) {
    relabelMap[prevId] = newId;
    // remap
    if (prevId.startsWith('_:')) {
      return traverse.map(object, function(x) {
        if (this.key !== 'instanceOf' && x === prevId) {
          this.update(newId);
        }
      });
    }
  }

  return object;
}
