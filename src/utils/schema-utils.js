import urlTemplate from 'url-template';
import { arrayify } from '@scipe/jsonld';

export function getParts(root, nodeMap) {
  if (nodeMap) {
    if ('@graph' in nodeMap) {
      nodeMap = arrayify(nodeMap['@graph']).reduce((nodeMap, node) => {
        nodeMap[node['@id']] = node;
        return nodeMap;
      }, {});
    }

    if (typeof root === 'string') {
      root = nodeMap[root] || root;
    }
  }

  if (!root || !root.hasPart) {
    return [];
  }

  return arrayify(root.hasPart).reduce(function(parts, part) {
    if (typeof part === 'string') {
      part = nodeMap[part] || part;
    }
    return parts.concat(part, getParts(part, nodeMap));
  }, []);
}

/**
 * Note:  when object.isPartOf is a list, we take the first item
 * This works as if an object has several issues, they must all have the same periodical
 */
export function getRootPart(object) {
  let root;
  if (object && object.isPartOf) {
    root = object;
    while (root && root.isPartOf) {
      root = arrayify(root.isPartOf)[0];
    }
  }
  return root;
}

export function getRootPartId(object) {
  const root = getRootPart(object);
  if (root) {
    return typeof root === 'string' ? root : root['@id'];
  }
}

export function getChecksumValue(object, algorithm = 'nash') {
  if (!object) return;
  if (object.contentChecksum) {
    const checksums = Array.isArray(object.contentChecksum)
      ? object.contentChecksum
      : [object.contentChecksum];

    const checksum = checksums.find(
      checksum =>
        checksum.checksumAlgorithm === algorithm && checksum.checksumValue
    );
    if (checksum) {
      return checksum.checksumValue;
    }
  }
}

export function getAgent(agent) {
  const personOrOrganization =
    (agent &&
      (agent.agent ||
        agent.recipient ||
        agent.participant ||
        agent.creator ||
        agent.author ||
        agent.contributor ||
        agent.producer ||
        agent.reviewer ||
        agent.editor ||
        agent.sender ||
        agent.accountablePerson ||
        agent.copyrightHolder ||
        agent.director ||
        agent.illustrator ||
        agent.knows ||
        agent.publishedBy ||
        agent.reviewedBy ||
        agent.sibling ||
        agent.spouse ||
        agent.translator ||
        agent.grantee ||
        agent.member)) ||
    agent;

  // Due to the context, personOrOrganization could be a list (for instance author could be defined as @container: @list)
  return Array.isArray(personOrOrganization)
    ? personOrOrganization[0]
    : personOrOrganization;
}

export function getAgentId(agent) {
  const personOrOrganization = getAgent(agent);
  if (personOrOrganization) {
    return typeof personOrOrganization === 'string'
      ? personOrOrganization
      : personOrOrganization['@id'];
  }
}

/**
 * Given a schema.org Action, return the object upon which the
 * action is carried out.
 *
 * @param {Object} action - A schema.org Action.
 * @return {Object} - The object upon which the action is carried out.
 */
export function getObject(action) {
  if (!action) return;
  // TODO make stricter (check that type is a role and only if so do object.object
  if (action.object) {
    return action.object.object || action.object;
  }
}

/**
 * Given a schema.org Action, return the ID of the object upon which the
 * action is carried out.
 *
 * @param {Object} action - A schema.org Action.
 * @return {String} - The ID of the object upon which the action is carried out.
 */
export function getObjectId(action) {
  const object = getObject(action);
  if (object) {
    return typeof object === 'string' ? object : object['@id'];
  }
}

export function getResult(action) {
  if (!action) return;
  if (action.result) {
    return action.result.result || action.result;
  }
}

export function getResultId(action) {
  const result = getResult(action);
  if (result) {
    return typeof result === 'string' ? result : result['@id'];
  }
}

export function getTargetCollection(action) {
  if (!action) return;
  if (action.targetCollection) {
    return action.targetCollection.targetCollection || action.targetCollection;
  }
}

export function getTargetCollectionId(action) {
  const targetCollection = getTargetCollection(action);
  if (targetCollection) {
    return typeof targetCollection === 'string'
      ? targetCollection
      : targetCollection['@id'];
  }
}

export function getInstrument(action) {
  if (!action) return;
  if (action.instrument) {
    return action.instrument.instrument || action.instrument;
  }
}

export function getInstrumentId(action) {
  const instrument = getInstrument(action);
  if (instrument) {
    return typeof instrument === 'string' ? instrument : instrument['@id'];
  }
}

export function getInstrumentOf(action) {
  if (!action) return;
  if (action.instrumentOf) {
    return action.instrumentOf.instrumentOf || action.instrumentOf;
  }
}

export function getInstrumentOfId(action) {
  const instrumentOf = getInstrumentOf(action);
  if (instrumentOf) {
    return typeof instrumentOf === 'string'
      ? instrumentOf
      : instrumentOf['@id'];
  }
}

export function renderUrlTemplate(action, params, target) {
  target = target || action.target;

  if (target && Array.isArray(target) && target.length === 1) {
    target = target[0];
  }

  if (!target || !target.urlTemplate) {
    return '';
  }

  return urlTemplate
    .parse(target.urlTemplate)
    .expand(getUrlTemplateCtx(action, params));
}

export function getUrlTemplateCtx(action, params) {
  action = action || {};
  params = params || {};
  let ctx = {};

  _traverse(
    action,
    function(key, value) {
      if (/-input$|-output$/.test(key)) {
        if (
          'valueName' in value &&
          ('defaultValue' in value || value.valueName in params)
        ) {
          ctx[value.valueName] = params[value.valueName] || value.defaultValue;
        }
      }
    },
    this
  );

  return ctx;
}

function _traverse(obj, func, ctx) {
  for (var i in obj) {
    func.apply(ctx || this, [i, obj[i]]);
    if (obj[i] !== null && typeof obj[i] == 'object') {
      _traverse(obj[i], func, ctx);
    }
  }
}
