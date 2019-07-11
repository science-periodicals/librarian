import uuid from 'uuid';
import slug from 'slug';
import createError from '@scipe/create-error';
import { getId, unprefix } from '@scipe/jsonld';
import { toIndexableString } from '@scipe/collate';
import { createHash } from 'web-verse';
import getScopeId from './utils/get-scope-id';
import {
  CONTACT_POINT_ADMINISTRATION,
  CONTACT_POINT_EDITORIAL_OFFICE,
  CONTACT_POINT_GENERAL_INQUIRY
} from './constants';

export default function createId(type, id, scopeId, extra) {
  if (typeof id === 'number') {
    id = id.toString();
  }
  if (id != null) {
    id = getId(id);
  }
  if (scopeId != null) {
    if (type === 'srole' || type === 'cnode') {
      scopeId = getId(scopeId);
    } else {
      scopeId = getScopeId(scopeId);
    }
  }
  if (id === null) {
    id = undefined;
  }
  if (scopeId === null) {
    scopeId = undefined;
  }

  // Global scopeId validation
  if (scopeId && type !== 'srole' && type !== 'cnode') {
    // scopes are related to ACL and can only be user, org, journal or graph
    if (
      !scopeId.startsWith('user:') &&
      !scopeId.startsWith('org:') &&
      !scopeId.startsWith('journal:') &&
      !scopeId.startsWith('graph:')
    ) {
      throw createError(
        400,
        `createId invalid scopeId parameter (got ${scopeId})`
      );
    }
  }

  switch (type) {
    // embeded nodes (no need for _id)
    case 'audience': {
      if (!scopeId) {
        throw createError(400, `createId: ${type} need a scopeId parameter`);
      }
      const roleName = id;
      const ns = unprefix(getScopeId(scopeId));
      const title = extra;
      return {
        '@id': `audience:${createHash(
          [ns, roleName, title].filter(Boolean).join('-')
        )}`
      };
    }

    case 'blank':
      return { '@id': `_:${unprefix(id) || uuid.v4()}` };

    case 'tag':
      // blank node made of the slug of the tagname (specifed as id)
      return {
        '@id': `tag:${slug(unprefix(id) || uuid.v4(), {
          symbols: false,
          lower: true
        })}`
      };

    case 'contact': {
      const contactType = id;

      if (!scopeId) {
        throw createError(400, `createId: ${type} need a scopeId parameter`);
      }

      if (scopeId.startsWith('user:')) {
        if (
          contactType !== CONTACT_POINT_ADMINISTRATION &&
          contactType !== CONTACT_POINT_EDITORIAL_OFFICE &&
          contactType !== CONTACT_POINT_GENERAL_INQUIRY
        ) {
          throw createError(
            400,
            'createId ${type} invalid contactType for ${scopeId} (got ${contactType})'
          );
        }
      } else if (scopeId.startsWith('org:')) {
        if (
          contactType !== CONTACT_POINT_ADMINISTRATION &&
          contactType !== CONTACT_POINT_GENERAL_INQUIRY
        ) {
          throw createError(
            400,
            'createId ${type} invalid contactType for ${scopeId} (got ${contactType})'
          );
        }
      } else {
        throw createError(
          400,
          `createId ${type} invalid scopeId (got ${scopeId})`
        );
      }

      // User and Organization can have contact point
      const contactId = scopeId.replace(/:/g, '-'); // we replace user: or org: by user- and org-

      return {
        '@id': `contact:${contactId}@${slug(contactType, {
          symbols: false,
          lower: true
        })}`
      };
    }

    case 'token':
    case 'stripe': // used for stripe accounts
    case 'arole': // audience role
    case 'role':
    case 'node': {
      return {
        '@id': `${type}:${unprefix(id) || uuid.v4()}`
      };
    }

    case 'cnode': {
      // used to generate client side node that can be validated. Those are
      // embeded in embedderDocId (an action @id) and have the form
      // cnode:<client-side-generated-uuid>@<unprefix(embedderDocId)>
      const embedderDocId = getId(scopeId);
      if (!embedderDocId) {
        throw createError(
          400,
          `createId ${type} invalid scopeId (got ${scopeId}). scopeId must be the @id of the embedder document`
        );
      }
      id = id || uuid.v4();
      return {
        '@id': `${type}:${unprefix(id).split('@')[0]}@${unprefix(
          embedderDocId
        )}`
      };
    }

    case 'srole': {
      // sub roles (typically in action.participant)
      const roleId = scopeId;
      if (!roleId || !roleId.startsWith('role:')) {
        throw createError(
          400,
          `createId: scopeId need to be a roleId (got ${roleId})`
        );
      }
      return {
        '@id': `${type}:${unprefix((id || '').split('@')[0]) ||
          uuid.v4()}@${unprefix(roleId)}`
      };
    }

    // ------------------ //

    // need _id (stored as proper document in CouchDB)

    case 'user': {
      if (!id) throw createError(400, `createId: ${type} need an id parameter`);
      const username = unprefix(id.replace('org.couchdb.user:', ''));
      return {
        '@id': `user:${username}`,
        _id: `org.couchdb.user:${username}`
      };
    }

    case 'profile': {
      if (!id) throw createError(400, `createId: ${type} need an id parameter`);
      const username = unprefix(id.replace('org.couchdb.user:', ''));
      return {
        '@id': `user:${username}`,
        _id: toIndexableString([username, 'profile'])
      };
    }

    case 'org': {
      if (!id) {
        throw createError(400, `createId: ${type} need an id parameter`);
      }
      id = `${type}:${slug(unprefix(id), {
        symbols: false,
        lower: true
      })}`;

      return { '@id': id, _id: toIndexableString([id, 'org']) };
    }

    case 'journal':
      if (!id) {
        throw createError(400, `createId: ${type} need an id parameter`);
      }
      // for journal, `id` can be specified as a hostname e.g. joghl.sci.pe => we remove '.sci.pe'
      // this is usefull in app-suite to get the periodicalId from a hostname
      id = `${type}:${slug(unprefix(id.replace(/\.sci\.pe$/, '')), {
        symbols: false,
        lower: true
      })}`;

      return { '@id': id, _id: toIndexableString([scopeId || id, type, id]) };

    case 'graph':
      if (id) {
        // slug() will replace `--` to `-` so we workaround it
        id = unprefix(id.split('?')[0])
          .split('--')
          .map(idPart =>
            slug(idPart, {
              symbols: false,
              lower: true
            })
          )
          .join('--');
        id = `${type}:${id}`;
      } else {
        id = `${type}:${uuid.v4()}`;
      }

      return {
        '@id': id,
        _id: toIndexableString([id, type])
      };

    case 'release': {
      const isLatest = extra;
      let version = id;

      if (!version) {
        throw createError(
          400,
          `createId: ${type} need an id parameter specifying the version (semver)`
        );
      }

      if (!scopeId || !scopeId.startsWith('graph:')) {
        throw createError(
          400,
          `createId: ${type} need a scopeId parameter (Graph @id)`
        );
      }

      scopeId = createId('graph', scopeId)['@id'];

      return {
        '@id': `${scopeId}?version=${version}`,
        _id: toIndexableString([scopeId, type, isLatest ? 'latest' : version])
      };
    }

    case 'issue': {
      const isLatest = extra;

      if (!scopeId || !scopeId.startsWith('journal:')) {
        throw createError(
          400,
          `createId: ${type} need a scopeId parameter (Periodical @id)`
        );
      }

      // ensure right prefix
      // !! id could be a number
      const splt = (id == null ? uuid.v4() : id.toString()).split('/', 2);

      id = `${type}:${unprefix(scopeId)}/${slug(
        unprefix(splt.length === 2 ? splt[1] : splt[0]),
        {
          symbols: false,
          lower: true
        }
      )}`;

      return {
        '@id': id,
        _id: toIndexableString([scopeId, type, isLatest ? 'latest' : id])
      };
    }

    case 'workflow': {
      const workflowSpecificationRev = extra;

      if (workflowSpecificationRev && !scopeId) {
        throw createError(
          400,
          `createId: ${type} need a scopeId parameter (Periodical @id) when called with extra`
        );
      }
      if (scopeId && !scopeId.startsWith('journal:')) {
        throw createError(
          400,
          `createId: ${type} scopeId parameter must be a (Periodical @id)`
        );
      }

      id = `${type}:${unprefix(id) || uuid.v4()}`;
      if (workflowSpecificationRev) {
        id += `?version=${workflowSpecificationRev}`;
      }

      return scopeId
        ? {
            '@id': id,
            _id: toIndexableString([scopeId, type, id])
          }
        : {
            '@id': id
          };
    }

    case 'type': {
      const publicationTypeRev = extra;

      id = `${type}:${unprefix(id) || uuid.v4()}`;
      if (publicationTypeRev) {
        id += `?version=${publicationTypeRev}`;
      }

      if (!scopeId || !scopeId.startsWith('journal:')) {
        throw createError(
          400,
          `createId: ${type} need a scopeId parameter (Periodical @id)`
        );
      }

      return {
        '@id': id,
        _id: toIndexableString([scopeId, type, id])
      };
    }

    case 'service':
      id = `${type}:${unprefix(id) || uuid.v4()}`;

      if (!scopeId || !scopeId.startsWith('org:')) {
        throw createError(
          400,
          `createId: ${type} need a scopeId parameter (Organization @id)`
        );
      }

      return {
        '@id': id,
        _id: toIndexableString([scopeId, type, id])
      };

    case 'action':
      id = `${type}:${unprefix(id) || uuid.v4()}`;
      return {
        '@id': id,
        _id: toIndexableString([scopeId || id, type, id])
      };

    default:
      throw createError(400, `createId: invalid type ${type}`);
  }
}
