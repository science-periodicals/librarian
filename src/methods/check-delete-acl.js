import isPlainObject from 'lodash/isPlainObject';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { getFramedGraphTemplate } from '../utils/workflow-actions';

/**
 * Note: `node` can only be "deleted" through UpdateAction (and subclasses)
 * Note: stripe account can only be deleted trhough deleting the organization
 */
export default async function checkDeleteAcl(object, { acl, store } = {}) {
  if (typeof object !== 'string' && !isPlainObject(object)) {
    throw createError(400, 'Invalid object parameter for checkDeleteAcl');
  }

  if (String(acl) === 'false') {
    return;
  }

  const check = await this.checkAcl({
    acl,
    store,
    docs: [object],
    checkActiveInviteActions: false
  });

  if (check('readOnlyUser')) {
    throw createError(403, 'not allowed, readOnlyUser cannot delete');
  }

  object = await this.get(object, {
    store,
    acl: false
  });
  const [scopeId, type] = parseIndexableString(object._id);

  let hasPermission;

  switch (type) {
    case 'issue':
      // we can only delete SpecialPublicationIssue
      hasPermission =
        object['@type'] === 'SpecialPublicationIssue' &&
        (check.isAdmin || check([scopeId, 'AdminPermission']));
      break;

    case 'org':
    case 'journal':
      hasPermission = check.isAdmin || check([scopeId, 'AdminPermission']);
      break;

    case 'graph': {
      const graph = object;
      if (graph.version == null) {
        if (check.isAdmin || check([scopeId, 'AdminPermission'])) {
          hasPermission = true;
        } else if (check([scopeId, 'WritePermission'])) {
          // if Graph hasn't been submitted yet it can be deleted by user who can Perform CreateReleaseAction of submssion stage (typically author)
          const workflowSpecification = await this.get(graph.workflow, {
            store,
            acl: false
          });
          const framedGraphTemplate = await getFramedGraphTemplate(
            workflowSpecification
          );
          const submissionStageTemplate = arrayify(
            framedGraphTemplate.potentialAction
          ).find(action => action['@type'] === 'StartWorkflowStageAction');

          if (submissionStageTemplate) {
            const [
              submissionStage
            ] = await this.getInstantiatedStagesByGraphIdAndTemplateId(
              scopeId,
              getId(submissionStageTemplate),
              { store }
            );

            if (submissionStage) {
              const createRelease = arrayify(submissionStage.result).find(
                action => action['@type'] === 'CreateReleaseAction'
              );

              if (createRelease) {
                const createReleaseActions = await this.getActionsByStageIdAndTemplateId(
                  getId(submissionStage),
                  getId(createRelease.instanceOf),
                  { store }
                );

                hasPermission = arrayify(createReleaseActions).some(action =>
                  check([scopeId, action, 'PerformActionPermission'])
                );
              }
            }
          }
        }
      }
      break;
    }

    case 'action': {
      const action = object;
      switch (action['@type']) {
        case 'UploadAction':
        case 'InviteAction':
        case 'ApplyAction':
        case 'InformAction':
          hasPermission =
            (action.actionStatus === 'PotentialActionStatus' ||
              action.actionStatus === 'ActiveActionStatus') &&
            (check.isAdmin ||
              check(object.agent) ||
              check([scopeId, 'AdminPermission']));
          break;

        case 'CommentAction':
          hasPermission =
            check.isAdmin ||
            check(action.agent) ||
            check([scopeId, 'AdminPermission']);
          break;

        case 'RequestArticleAction':
          hasPermission =
            check.isAdmin ||
            ((action.actionStatus === 'PotentialActionStatus' ||
              action.actionStatus === 'ActiveActionStatus') &&
              (check(action.agent) ||
                check([scopeId, 'AdminPermission']) ||
                check([scopeId, 'WritePermission'])));
          break;

        case 'TagAction':
          hasPermission =
            check.isAdmin ||
            check(action.agent) ||
            check([scopeId, 'AdminPermission']);
          break;

        default:
          break;
      }
      break;
    }

    default:
      break;
  }

  if (!hasPermission) {
    throw createError(
      403,
      `Not allowed to delete ${object['@type']} ${getId(object)}`
    );
  }
}
