import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import { getObjectId } from '../utils/schema-utils';
import handleParticipants from '../utils/handle-participants';

/**
 * Used so that author confirm their authorship on submissions
 *
 * Note: An author reject his authorship by setting the CheckAction
 * in FailedActionStatus. An `error` can also be specified for a reason
 * Important: CheckAction only apply to `author` and `contributor` of
 * the main entity _NOT_ the `Graph` (`graph.author` or `graph.contributor`)
 * => checkAction.agent === graph.mainEntity.author
 * Role @ids for Graph author and mainEntity authors are totally independant
 * so that we avoid sync issues with async invite to graph while a DS3
 * (containing author roles) is processed
 */
export default async function handleCheckAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (!prevAction) {
    throw createError(
      400,
      `${
        action['@type']
      }: could not find prev action created during a Graph UpdateAction`
    );
  }

  // be sure that only actionStatus is mutated;
  action = Object.assign(
    {
      startTime: new Date().toISOString()
    },
    prevAction,
    pick(action, ['actionStatus', 'error'])
  );

  if (
    action.actionStatus !== 'CompletedActionStatus' &&
    action.actionStatus !== 'FailedActionStatus'
  ) {
    throw createError(
      400,
      `${
        action['@type']
      } actionStatus must be CompletedActionStatus or FailedActionStatus`
    );
  }

  const scope = await this.get(getScopeId(getObjectId(action)), {
    store,
    acl: false
  });

  return this.put(handleParticipants(action, scope), { store, force: true });
}
