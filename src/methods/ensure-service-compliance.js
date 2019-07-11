import isPlainObject from 'lodash/isPlainObject';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import {
  validateDateTimeDuration,
  validatePriceSpecification,
  validateCustomers
} from '../validators';
import findRole from '../utils/find-role';
import remapRole from '../utils/remap-role';
import createId from '../create-id';
import getScopeId from '../utils/get-scope-id';

/**
 * - Make `action` safe and compliant with the Service (service.serviceOutput)
 * See also `librarian#ensureWorkflowCompliance`
 */
export default async function ensureServiceCompliance(
  action, // Typically a TypesettingAction
  prevAction,
  graph, // live graph
  { store, triggered, now = new Date().toISOString() } = {}
) {
  if (triggered) {
    return action;
  }

  // Ensure that all the docs required for triggers are present before proceeding further
  await this.ensureAllWorkflowActionsStateMachineStatus(getId(graph), {
    store
  });

  const sourceAgent = findRole(action.agent, graph, {
    ignoreEndDateOnPublicationOrRejection: true
  });

  if (!sourceAgent) {
    throw createError(
      400,
      `Invalid agent for ${
        action['@type']
      }, agent could not be found in the Graph (${getId(graph)})`
    );
  }

  const messages = validateDateTimeDuration(action).concat(
    validatePriceSpecification(
      action.expectsAcceptanceOf &&
        action.expectsAcceptanceOf.priceSpecification
    ),
    validateCustomers(action, graph)
  );
  if (messages.length) {
    throw createError(400, `Invalid ${action['@type']}: ${messages.join(' ')}`);
  }

  // There must be a prevAction as service action are only instantiated by BuyAction
  if (!prevAction) {
    throw createError(
      403,
      `User cannot create ${action['@type']} and must use a BuyAction to do so`
    );
  }

  const actionTemplateId = getId(prevAction.instanceOf);
  const service = await this.getServiceByServiceOutputId(actionTemplateId);

  const actionTemplate = arrayify(service.serviceOutput).find(
    template => getId(template) === actionTemplateId
  );

  if (
    actionTemplate.agent &&
    ((actionTemplate.agent.roleName &&
      actionTemplate.agent.roleName !== sourceAgent.roleName) ||
      (actionTemplate.agent.name &&
        actionTemplate.agent.name !== sourceAgent.name))
  ) {
    throw createError(
      400,
      `Agent of ${
        action['@type']
      } is not compliant with the definition of the action template`
    );
  }

  // handle `activateOn`
  if (
    prevAction.activateOn &&
    (action.actionStatus === 'ActiveActionStatus' ||
      action.actionStatus === 'StagedActionStatus' ||
      action.actionStatus === 'CompletedActionStatus')
  ) {
    throw createError(
      400,
      `${getId(action)} (${action['@type']}) actionStatus cannot be set to ${
        action.actionStatus
      } given the activateOn property. The action will be activated based on the trigger (${
        prevAction.activateOn
      })`
    );
  }

  // handle `completeOn`
  if (
    prevAction.completeOn &&
    action.actionStatus === 'CompletedActionStatus'
  ) {
    throw createError(
      400,
      `${getId(action)} (${action['@type']}) actionStatus cannot be set to ${
        action.actionStatus
      } given the completeOn property. The action will be activated based on the trigger (${
        prevAction.completeOn
      })`
    );
  }

  // Make `action` safe:
  // Only certain props can be set by the user we overwrite every other prop with the
  // value from the template
  // Note: finer grained validation may be performed by the specific action handlers.
  action = Object.assign(
    omit(prevAction, ['_rev']), // `prevAction` and not `actionTemplate` as `prevAction` was safe by construction and may have other accumulated other changes (of valid prop) through time
    pick(action, ['actionStatus', 'result', 'comment', 'autoUpdate']),
    {
      agent: remapRole(sourceAgent, 'agent')
    }
  );

  // Be sure that `comment` have an @id and dateCreated
  if (action.comment) {
    action.comment = dearrayify(
      action.comment,
      arrayify(action.comment).map(comment => {
        if (isPlainObject(comment)) {
          return Object.assign(
            { '@type': 'Comment', dateCreated: now },
            comment,
            createId('node', comment, getScopeId(action))
          );
        }
        return comment;
      })
    );
  }

  return action;
}
