import omit from 'lodash/omit';
import { arrayify, dearrayify, nodeify } from '@scipe/jsonld';
import { parseRoleIds, getSourceRoleId } from '../utils/role-utils';
import findRole from './find-role';
import { EDITABLE_OFFLINE_TYPES } from '../constants';

/* How blinding works:

   We mostly rely on uniderectional replication from CouchDB -> PouchDB.  During
   that replication, we intercept the documents replicated and "anonymize" them
   using librarian.anonymize => The document content is different in between
   PouchDB (anonymized) and CouchDB (clear so that we can query per userId).
   This is fine as we don't replicate back from PouchDB -> CouchDB.

   summary: CouchDB -> anonymize -> PouchDB -> never flows back to CouchDB

   This pattern break for some documents as we offer offline editing support for
   active and staged workflow actions (e.g ReviewAction, CommentAction) => those
   are the only documents that can get updated on PouchDB and replicated back to
   CouchDB. The issue here is that if we were to use the `anonymize` function
   and inverse it on the replication from PouchDB -> CouchDB we would run into
   issues with the `_rev` as the PouchDB `_rev` would have been computed based
   on the anonymized document whereas the one on CouchDB should be computed
   based on the clear version.

   => Those document cannot be run through the `anonymize` function.  Instead,
   we remove any reference to user @id when there are active or staged =>
   app-suite needs to be able to work with just the role @id (which are safe /
   random and non correlated with the user @ids)

   Those documents _cannot_ be completed or marked as endorsed, failed or
   canceled offline (through replication). A call to `librarian.post` must be
   made for that => we use that opportunity to add the user @id references back
   at that point so that we can query those document by userId. This is
   especially important to display the list of completed notification in the
   dashboard.

   Documents that are no longer active or staged are then only replicated from
   CouchDB -> PouchDB and we are back to the normal pattern relying on
   `anonymize`
 */

/**
 * Note: this is typically called _after_ `handleParticipants`
 * Note: `action` (same ref as input) is returned if nothing was changed this is
 * important as some method like syncParticipant rely on ref equality
 */
export default function handleUserReferences(
  action,
  object,
  { forceRemove = false } = {}
) {
  if (
    (!action || !EDITABLE_OFFLINE_TYPES.has(action['@type'])) &&
    !forceRemove
  ) {
    return action;
  }

  const nextAction = Object.assign({}, action);
  let hasChanged = false;
  if (
    forceRemove ||
    action.actionStatus === 'ActiveActionStatus' ||
    action.actionStatus === 'StagedActionStatus'
  ) {
    // remove userId references
    ['agent', 'participant', 'recipient'].forEach(p => {
      if (action[p]) {
        nextAction[p] = dearrayify(
          action[p],
          arrayify(action[p]).map(role => {
            const { userId } = parseRoleIds(role);
            if (userId) {
              hasChanged = true;
              return omit(role, [p]);
            }
            return role;
          })
        );
      }
    });
  } else {
    // add back userId references
    ['agent', 'participant', 'recipient'].forEach(p => {
      if (action[p]) {
        nextAction[p] = dearrayify(
          action[p],
          arrayify(action[p]).map(role => {
            const roleId = getSourceRoleId(role);
            if (roleId) {
              const roleWithUserId = findRole(roleId, object, {
                active: false
              });
              if (roleWithUserId) {
                const { userId } = parseRoleIds(roleWithUserId);
                if (userId) {
                  hasChanged = true;
                  return Object.assign({}, nodeify(role), {
                    [p]: userId
                  });
                }
              }
            }
            return role;
          })
        );
      }
    });
  }

  return hasChanged ? nextAction : action;
}
