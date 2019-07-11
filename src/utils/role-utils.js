import { getId, arrayify, dearrayify, getNodeMap } from '@scipe/jsonld';
import schema from './schema';
import { getAgentId, getAgent, getParts } from './schema-utils';
import createId from '../create-id';

// TODO centralize all the role utils here

export function getSourceRoleId(
  role // role: or srole:
) {
  const id = getId(role);
  if (!id) return id;

  if (id.startsWith('role:')) {
    return id;
  }

  if (id.startsWith('srole:')) {
    return createId('role', id.split('@')[1])['@id'];
  }

  // TODO return undefined if not a role @id ?
  return id;
}

/**
 * !! this does not handle `srole:`
 */
export function parseRoleIds(role) {
  let roleId, userId;
  const id = getId(role);
  const unroledId = getAgentId(role);

  if (id && id.startsWith('role:')) {
    roleId = id;
  }

  if (id && id.startsWith('user:')) {
    userId = id;
  } else if (unroledId && unroledId.startsWith('user:')) {
    userId = unroledId;
  }

  return { roleId, userId };
}

/**
 * Terminate a role (set it's endDate)
 */
export function endRole(
  role, // a valid Role
  object, // a Graph, Periodical or Organization
  { now = new Date().toISOString } = {}
) {
  const roleProp =
    object['@type'] === 'Organization' ? 'member' : role.roleName;

  return Object.assign({}, object, {
    [roleProp]: arrayify(object[roleProp]).map(_role => {
      if (getId(_role) === getId(role)) {
        return Object.assign({ endDate: new Date().toISOString() }, _role);
      }

      return _role;
    })
  });
}

export function endUserRoles(
  userId, // a valid userId starting with `user:`
  object, // a Graph, Periodical or Organization
  { now = new Date().toISOString } = {}
) {
  return Object.assign(
    {},
    object,
    ['member', 'editor', 'reviewer', 'producer', 'author'].reduce(
      (overwrite, prop) => {
        if (prop in object) {
          overwrite[prop] = arrayify(object[prop]).map(role => {
            if (getAgentId(role) === userId) {
              return endRole(role, object, { now });
            }
            return role;
          });
        }

        return overwrite;
      },
      {}
    )
  );
}

export function endGraphRoles(graph, { now = new Date().toISOString() }) {
  const overwrite = {};
  ['author', 'contributor', 'reviewer', 'producer', 'editor'].forEach(p => {
    if (graph[p])
      overwrite[p] = dearrayify(
        graph[p],
        arrayify(graph[p]).map(role => {
          if (role.startDate) {
            return Object.assign({ endDate: now }, role);
          }
          return role;
        })
      );
  });

  const entityRoleMap = new Set(getGraphMainEntityContributorRoles(graph));
  if (entityRoleMap.size && graph['@graph']) {
    overwrite['@graph'] = dearrayify(
      graph['@graph'],
      arrayify(
        graph['@graph'].map(node => {
          if (entityRoleMap.has(getId(node)) && node.startDate) {
            return Object.assign({ endDate: now }, node);
          }

          return node;
        })
      )
    );
  }

  if (Object.keys(overwrite).length) {
    return Object.assign({}, graph, overwrite);
  }

  return graph;
}

// TODO unify with getActiveAudience (in workflow-utils.js)
export function getActiveAudiences(
  roles, // typically action.participant
  { now = new Date().toISOString() } = {}
) {
  return arrayify(roles)
    .filter(role => {
      const unroled = getAgent(role);
      if (role && role.roleName) {
        return (
          unroled &&
          unroled.audienceType &&
          (!role.endDate || role.endDate > now) &&
          (!role.startDate || role.startDate <= now)
        );
      }

      return unroled && unroled.audienceType;
    })
    .map(role => getAgent(role));
}

export function filterActiveRoles(
  roles = [],
  { now = new Date().toISOString() } = {}
) {
  return arrayify(roles).filter(role => {
    return (
      role &&
      (role.roleName || schema.is(role, 'Role')) &&
      (!role.endDate || role.endDate > now) &&
      (!role.startDate || role.startDate <= now)
    );
  });
}

export function getGraphMainEntityContributorRoles(
  graph = {},
  { rootOnly = false } = {}
) {
  const roles = [];
  if (getId(graph.mainEntity)) {
    const nodeMap = getNodeMap(graph);
    const root = nodeMap[getId(graph.mainEntity)];

    if (root) {
      const parts = rootOnly ? [root] : [root].concat(getParts(root, nodeMap));
      parts.forEach(part => {
        ['author', 'contributor'].forEach(p => {
          arrayify(part[p]).forEach(roleId => {
            roleId = getId(roleId);
            if (roleId) {
              let role = nodeMap[roleId];
              if (
                role &&
                role.roleName &&
                getId(role) &&
                !roles.some(_role => getId(_role) === getId(role))
              ) {
                // JSON-LD flatten creates arrays here we reverse that for convenience
                if (getId(role[p]) && Array.isArray(role[p])) {
                  role = Object.assign({}, role, {
                    [p]: getId(role[p])
                  });
                }
                roles.push(role);
              }
            }
          });
        });
      });
    }
  }
  return roles;
}

export function checkIfRoleIsActive(
  role = {},
  {
    now = new Date().toISOString(),
    ignoreEndDateOnPublicationOrRejection = false, // TODO rename to `ignoreEndDateOnGraphDateEnded`
    scope = {} // needed if `ignoreEndDateOnPublicationOrRejection` is `true`
  } = {}
) {
  return (
    (!role.startDate || role.startDate <= now) &&
    (!role.endDate ||
      role.endDate > now ||
      // Note `datePublished` and `dateRejected` are legacy and `dateEnded` is safer (as datePublished can be set in past when legacy content is imported)
      (ignoreEndDateOnPublicationOrRejection &&
        scope.datePublished === role.endDate) ||
      (ignoreEndDateOnPublicationOrRejection &&
        scope.dateRejected === role.endDate) ||
      (ignoreEndDateOnPublicationOrRejection &&
        scope.dateEnded === role.endDate))
  );
}
