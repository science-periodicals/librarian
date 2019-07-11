import { arrayify, dearrayify, getId, unrole } from '@scipe/jsonld';
import { parseRoleIds, getSourceRoleId } from './role-utils';

/**
 * Mark document as deleted in a safe way with respect to filtered
 * replication
 */
export default function flagDeleted(
  doc,
  { now = new Date().toISOString() } = {}
) {
  if (!doc) return;

  // we will only keep a ref
  const refProps = new Set([
    '@id',
    'sameAs',
    'resourceOf',
    'isBasedOn',
    'instanceOf',
    'resultOf',
    // blob deletion
    'encodesCreativeWork'
  ]);

  const alwaysKeptProps = new Set([
    '@type',
    '_id',
    '_rev',
    'slug',
    'dateDeleted',
    'actionStatus',
    'hasDigitalDocumentPermission'
  ]);

  const unroleProps = new Set([
    'object' // need to keep the objectId in case of action so that we can filter out the action embedded in Graph.potential action for lucene indexing
  ]);

  const audienceProps = new Set([
    'agent',
    'participant',
    'recipient',
    'creator',
    'author',
    'contributor',
    'producer',
    'reviewer',
    'editor',
    'sender',
    'actor',
    'attendee',
    'composer',
    'director',
    'funder',
    'organizer',
    'performer',
    'translator'
  ]);

  return Object.keys(doc).reduce(
    (deleted, p) => {
      if (refProps.has(p)) {
        // need to keep resourceOf so that GraphMainEntity can be deleted in case of resources
        const ref = getId(doc[p]);
        if (ref) {
          deleted[p] = ref;
        }
      }

      if (alwaysKeptProps.has(p)) {
        deleted[p] = doc[p];
      }

      if (unroleProps.has(p)) {
        const unroledId = getId(unrole(doc, p));
        if (unroledId) {
          deleted[p] = unroledId;
        }
      }

      // we only keep role @id (when userId is defined) and userId. We discard audiences and audiencerole and any other data
      if (audienceProps.has(p)) {
        deleted[p] = dearrayify(
          doc[p],
          arrayify(doc[p])
            .map(value => {
              const { userId } = parseRoleIds(value);
              const sourceRoleId = getSourceRoleId(value); // we use getSourceRoleId instead of parseRoleIds as the role may be an `srole:`
              let roleId;
              if (sourceRoleId) {
                if (sourceRoleId.startsWith('role:')) {
                  roleId = getId(value);
                }
              }

              if (roleId && userId) {
                return {
                  '@id': roleId,
                  [p]: userId
                };
              } else if (roleId) {
                return roleId;
              } else if (userId) {
                return userId;
              }
            })
            .filter(Boolean)
        );

        if (
          deleted[p] == null ||
          (Array.isArray(deleted[p]) && !deleted[p].length)
        ) {
          delete deleted[p];
        }
      }

      return deleted;
    },
    {
      _deleted: true,
      dateDeleted: now
    }
  );
}
