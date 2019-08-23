import omit from 'lodash/omit';
import { parseIndexableString } from '@scipe/collate';
import { getId, arrayify } from '@scipe/jsonld';
import { getRootPartId, getTargetCollectionId } from '../utils/schema-utils';
import { hasPublicAudience } from '../acl';
import getScopeId from '../utils/get-scope-id';

/**
 * return doc if user has access and false otherwise
 */
export default function checkReadAclSync(doc, opts = {}) {
  let { acl = true, check, isPublic, isAdmin, scopeId } = opts;
  if (isAdmin == null) {
    isAdmin = check.isAdmin;
  }

  if (!acl) {
    return doc;
  }

  if (check && check.store) {
    doc = check.store.hydrate(doc); // Note: store.hydrate only change doc if it is a string so here it's safe if a scope was modified (for instance to include potential actions)
  }

  // perform acl to potential action stored in their own documents
  const potentialActions = arrayify(doc && doc.potentialAction).filter(
    action => {
      if (action._id) {
        return this.checkReadAclSync(
          action,
          Object.assign({}, opts, { isPublic: false })
        );
      }

      return true;
    }
  );

  if (doc && doc.potentialAction) {
    if (!potentialActions.length) {
      doc = omit(doc, ['potentialAction']);
    } else {
      doc = Object.assign({}, doc, {
        potentialAction: Array.isArray(doc.potentialAction)
          ? potentialActions
          : potentialActions[0]
      });
    }
  }

  const docId = getId(doc);

  let type;
  if (doc._id) {
    const parsed = parseIndexableString(doc._id);
    if (!scopeId) {
      scopeId = parsed[0];
    }
    type = parsed[1];
  } else {
    // infer type for embedded docs
    if (docId && docId.startsWith('role:')) {
      scopeId = getScopeId(doc);
      type = 'role';
    } else if (docId && (docId.startsWith('node:') || docId.startsWith('_:'))) {
      scopeId = getScopeId(doc);
      type = 'node';
    }

    if (!scopeId) {
      return false;
    }
  }

  let hasPermission;
  switch (type) {
    case 'graph':
    case 'release': {
      const journalId = getScopeId(getRootPartId(doc));

      hasPermission =
        isPublic ||
        isAdmin ||
        // if graph is public but not journal (so not `isPublic` case) we check that user has readAccess to the journal (private journal)
        (journalId &&
          hasPublicAudience(doc) &&
          (check([journalId, 'ReadPermission']) ||
            check([journalId, 'WritePermission']) ||
            check([journalId, 'AdminPermission']))) ||
        // Be sure to invalidated the public case as if graph is public, we also need journal access
        (check([scopeId, 'ReadPermission']) &&
          (!journalId || !hasPublicAudience(doc))) ||
        check([scopeId, 'WritePermission']) ||
        check([scopeId, 'AdminPermission']);
      break;
    }

    case 'role':
    case 'node':
      hasPermission =
        isPublic ||
        isAdmin ||
        check([scopeId, 'WritePermission']) ||
        check([scopeId, 'ReadPermission']) ||
        check([scopeId, 'AdminPermission']);
      break;

    case 'action':
      switch (doc['@type']) {
        case 'RegisterAction': {
          hasPermission =
            isAdmin ||
            arrayify(doc.agent).some(check) ||
            arrayify(doc.participant).some(check);
          break;
        }

        case 'UpdatePasswordAction': {
          hasPermission = isAdmin || check(getTargetCollectionId(doc));
          break;
        }

        case 'ResetPasswordAction': {
          hasPermission =
            isAdmin ||
            (arrayify(doc.agent).some(check) ||
              arrayify(doc.participant).some(check));
          break;
        }

        case 'CreateAuthenticationTokenAction': {
          hasPermission = isAdmin || check(doc.agent);
          break;
        }

        case 'InformAction': {
          hasPermission =
            isAdmin ||
            arrayify(doc.agent).some(check) ||
            arrayify(doc.sender).some(check) ||
            arrayify(doc.participant).some(check) ||
            arrayify(doc.recipient).some(check) ||
            arrayify(doc.toRecipient).some(check) ||
            arrayify(doc.ccRecipient).some(check) ||
            arrayify(doc.bccRecipient).some(check) ||
            // check recipient of email message
            arrayify(doc.instrument).some(instrument => {
              return (
                arrayify(instrument.recipient).some(check) ||
                arrayify(instrument.toRecipient).some(check) ||
                arrayify(instrument.ccRecipient).some(check) ||
                arrayify(instrument.bccRecipient).some(check) ||
                arrayify(instrument.sender).some(check)
              );
            });
          break;
        }

        case 'CreateWorkflowSpecificationAction':
        case 'CreatePublicationTypeAction':
          hasPermission = isAdmin || check([scopeId, 'AdminPermission']);
          break;

        case 'CreateGraphAction':
          hasPermission =
            isAdmin ||
            arrayify(doc.agent).some(check) ||
            check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'WritePermission']) ||
            check([scopeId, 'ReadPermission']);
          break;

        case 'BuyAction':
          hasPermission =
            isAdmin ||
            arrayify(doc.agent).some(check) ||
            arrayify(doc.participant).some(check);
          break;

        case 'TagAction':
          hasPermission =
            isAdmin ||
            ((check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'ReadPermission']) ||
              check([scopeId, 'WritePermission'])) &&
              arrayify(doc.agent)
                .concat(arrayify(doc.participant))
                .some(
                  agent =>
                    agent.roleName !== 'assigner' && check(agent, { scopeId })
                ));
          break;

        // workflow actions (note that StartWorfklowStageAction is special)
        case 'ReviewAction':
        case 'AssessAction':
        case 'ScheduleAction':
        case 'CreateReleaseAction':
        case 'DeclareAction':
        case 'PayAction':
        case 'TypesettingAction':
        case 'CommentAction':
        case 'PublishAction':
          hasPermission =
            isAdmin ||
            ((check([scopeId, 'AdminPermission']) ||
              check([scopeId, 'ReadPermission']) ||
              check([scopeId, 'WritePermission'])) &&
              (arrayify(doc.agent).some(agent => check(agent, { scopeId })) ||
                arrayify(doc.participant).some(participant =>
                  check(participant, {
                    scopeId
                  })
                ) ||
                arrayify(doc.recipient).some(recipient =>
                  check(recipient, { scopeId })
                )));

          // console.log(
          //   require('util').inspect(
          //     {
          //       doc,
          //       hasPermission,
          //       admin: check([scopeId, 'AdminPermission']),
          //       read: check([scopeId, 'ReadPermission']),
          //       write: check([scopeId, 'WritePermission']),
          //       agent: arrayify(doc.agent).some(agent =>
          //         check(agent, { scopeId })
          //       ),
          //       participant: arrayify(doc.participant).some(participant =>
          //         check(participant, { scopeId })
          //       ),
          //       recipient: arrayify(doc.recipient).some(recipient =>
          //         check(recipient, { scopeId })
          //       )
          //     },
          //     { depth: null }
          //   )
          // );

          break;

        case 'ActivateAction':
        case 'DeactivateAction':
        case 'ArchiveAction':
        case 'EndorseAction':
        case 'StartWorkflowStageAction': // we are permissive for StartWorkflowStageAction has it doesn't contain sensitive info. This is esp. important so that invited reviewer can see a preview of the ms _before_ accepting their invite
          hasPermission =
            isAdmin ||
            check([scopeId, 'ReadPermission']) ||
            check([scopeId, 'WritePermission']) ||
            check([scopeId, 'AdminPermission']);
          break;

        case 'UploadAction':
          hasPermission =
            isAdmin ||
            check([scopeId, 'AdminPermission']) ||
            check([scopeId, 'ReadPermission']) || // Note after publication, user may lose Write access => Read is important
            check([scopeId, 'WritePermission']);
          break;

        case 'AuthorizeContributorAction':
        case 'JoinAction':
        case 'ApplyAction':
        case 'InviteAction':
          // no need for scope access (this is esp. important for recipient who
          // won't have access to scope untill he accepts invite
          hasPermission =
            isAdmin ||
            arrayify(doc.agent).some(check) ||
            arrayify(doc.participant).some(check) ||
            arrayify(doc.recipient).some(check);
          break;

        case 'SubscribeAction':
        case 'CreateCustomerAccountAction':
        case 'CreatePaymentAccountAction':
          hasPermission = isAdmin || check([scopeId, 'AdminPermission']);
          break;

        case 'CheckAction':
          hasPermission =
            isAdmin ||
            check(doc.agent) ||
            arrayify(doc.participant).some(check);
          break;

        case 'RequestArticleAction':
          hasPermission =
            isAdmin ||
            isPublic || // scope (journal) is public
            check([scopeId, 'ReadPermission']) ||
            check([scopeId, 'WritePermission']) ||
            check([scopeId, 'AdminPermission']) ||
            check(doc.agent) ||
            arrayify(doc.participant).some(participant => check(participant));
          break;

        default:
          hasPermission =
            isAdmin ||
            check([scopeId, 'AdminPermission']) ||
            ((check([scopeId, 'ReadPermission']) ||
              check([scopeId, 'WritePermission'])) &&
              (arrayify(doc.agent).some(check) ||
                arrayify(doc.participant).some(check) ||
                arrayify(doc.recipient).some(check)));
          break;
      }
      break;

    case 'journal':
      hasPermission =
        isPublic ||
        isAdmin ||
        check([scopeId, 'ReadPermission']) ||
        check([scopeId, 'WritePermission']) ||
        check([scopeId, 'AdminPermission']);
      break;

    case 'issue':
      hasPermission =
        isPublic || // scope is public
        isAdmin ||
        check([scopeId, 'ReadPermission']) ||
        check([scopeId, 'WritePermission']) ||
        check([scopeId, 'AdminPermission']);
      break;

    case 'contact':
    case 'offer':
    case 'service':
    case 'org':
    case 'workflow':
    case 'profile':
    case 'type':
      hasPermission = true;
      break;

    default:
      hasPermission = isAdmin;
      break;
  }

  if (hasPermission) {
    return doc;
  }
}
