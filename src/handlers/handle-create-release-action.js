import omit from 'lodash/omit';
import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import setId from '../utils/set-id';
import getScopeId from '../utils/get-scope-id';
import { getStageId } from '../utils/workflow-actions';
import { versionNodes } from '../utils/blob-utils';
import { getObjectId } from '../utils/schema-utils';
import { setEmbeddedIds } from '../utils/embed-utils';
import { validateStylesAndAssets } from '../validators';
import {
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';

/**
 * Take a snapshot of the live Graph
 *
 * A CreateReleaseAction must be part of a workflow
 * Note release can only be taken if they were specified in a workflow stage, in
 * particular the version number are preset
 */
export default async function handleCreateReleaseAction(
  action,
  {
    triggered,
    store,
    prevAction,
    skipPayments,
    strict,
    sideEffects = true
  } = {},
  callback
) {
  const objectId = getObjectId(action);
  if (!objectId || objectId !== createId('graph', objectId)['@id']) {
    throw createError(
      400,
      `{createReleaseAction['@type']} object must point to a live Graph`
    );
  }

  const graph = await this.get(getScopeId(objectId), {
    acl: false,
    store
  });

  // Note `ensureWorkflowCompliance` takes care of ensuring that action.result `@id`, `@type` and `version` are properly set
  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      // Create the relase
      // Can only create 1 release at a time for a given graph
      // Note: we lock _before_ reading the latest version => by the time we read it
      // we know it's reliable and won't change
      const latestReleaseId = createId('release', 'latest', graph)['@id'];

      try {
        var lock = await this.createLock(latestReleaseId, {
          prefix: 'release',
          isLocked: null
        });
      } catch (err) {
        throw createError(
          423,
          `${getId(action)} (${
            action['@type']
          }) release ${latestReleaseId} already in progress`
        );
      }

      // global try catch to ensure lock is released on error
      try {
        const endTime = action.endTime || new Date().toISOString();

        let release = await this.createNash(
          versionNodes(
            setId(
              Object.assign(
                { '@type': 'Graph' },
                omit(action.result, ['potentialAction']),
                omit(graph, ['@id', '_id', '_rev']),
                graph.dateSubmitted ? undefined : { dateSubmitted: endTime },
                getId(action) ? { resultOf: getId(action) } : undefined
              ),
              createId('release', action.result.version, graph, true) // we specify `true` as last argument so that the _id is latest instead of the version (=> will be indexed in lucene)
            )
          )
        );
        release = setEmbeddedIds(release);

        // Note: we don't revalidate the node (`validateAndSetupNodeIds`) as they
        // were already validated when updating the Graph
        const messages = validateStylesAndAssets(release);
        if (messages.length) {
          throw createError(400, messages.join(' ; '));
        }

        // Create a copy of the current latest release (if any) and replace latest release by new one.
        // Note that we can't use CouchDB COPY as it requires to pass the
        // new destination as a header parameter and we can't give
        // unicode character to that. So we use a less efficient manual copy where we first
        // GET the previous release (`latestReleaseId`).
        let prevRelease;
        try {
          prevRelease = await this.get(latestReleaseId, {
            store,
            acl: false
          });
        } catch (err) {
          if (err.code !== 404) {
            throw err;
          }
        }

        if (prevRelease) {
          if (getId(prevRelease) === getId(release)) {
            // this can happen during retries, in this case we treat `prevRelease` as
            // the `release` so that there are not 2 releases with the same
            // version
            release._rev = prevRelease._rev;
            prevRelease = undefined; // needs to be `undefined` (not `null`) so that it works with arrayify
          } else {
            prevRelease = Object.assign(
              {},
              prevRelease,
              createId('release', prevRelease.version, graph) // _id had `latest` instead of the specific version previously, we now set it to the specific version
            );
            release._rev = prevRelease._rev;
            delete prevRelease._rev; // `prevRelease` will be a new document
          }
        }

        const handledAction = setId(
          handleUserReferences(
            handleParticipants(
              Object.assign(
                {
                  startTime: endTime,
                  endTime
                },
                action,
                {
                  result: pick(release, [
                    '@id',
                    '@type',
                    'version',
                    'description'
                  ]) // we embed the description so that the release notes are easily available in the UI
                }
              ),
              graph,
              endTime
            ),
            graph
          ),
          createId('action', action, graph)
        );

        // Set the startTime of the workflow action listed as potential action of the result of the CreateReleaseAction
        // Note that we do not use triggers for that as we favor a more declarative approach where the potential action has an ActionStatus of 'ActiveActionStatus'
        const stage = await this.get(getStageId(handledAction), {
          store,
          acl: false
        });

        let subStageActions = [];
        const templateInstance = arrayify(stage.result).find(
          result => getId(result) === getId(handledAction)
        );

        if (
          templateInstance &&
          templateInstance.result &&
          templateInstance.result.potentialAction
        ) {
          subStageActions = await this.get(
            arrayify(templateInstance.result.potentialAction),
            { acl: false, store }
          );

          subStageActions = subStageActions.map(action =>
            Object.assign({}, action, {
              startTime: new Date(new Date(endTime).getTime() + 1) // makes sure it's right _after_ for the timeline
            })
          );
        }

        if (!sideEffects) {
          return handledAction;
        }

        // need to be called when action is handled but _before_ it is saved or
        // side effects are executed so it can be easily retry if failures
        await this.createCharge(handledAction, { store, skipPayments });
        await this.createUsageRecord(handledAction, { store, skipPayments });
        await this.createInvoiceItem(handledAction, { store, skipPayments });

        // Issue / Update CheckActions:
        // we do that before saving the action so that if it fails the user restart
        if (
          handledAction.releaseRequirement === 'ProductionReleaseRequirement'
        ) {
          await this.syncCheckActions(graph, {
            store,
            now: endTime
          });
        }

        const [
          savedAction,
          savedRelease,
          ...otherSavedActions
        ] = await this.put(
          [handledAction, release].concat(
            arrayify(prevRelease),
            subStageActions
          ),
          { force: true, store }
        );

        try {
          await this.syncGraph(graph, savedAction, {
            store,
            updatePayload: Object.assign(
              {},
              savedRelease.identifier != null
                ? {
                    identifier: savedRelease.identifier + 1
                  }
                : undefined,
              graph.dateSubmitted
                ? undefined
                : { dateSubmitted: handledAction.endTime }
            )
          });
        } catch (err) {
          this.log.error({ err, action: savedAction }, 'error syncing graphs');
        }

        try {
          await this.syncWorkflow(
            [savedAction].concat(
              prevRelease ? otherSavedActions.slice(1) : otherSavedActions
            ),
            {
              store
            }
          );
        } catch (err) {
          this.log.error(
            { err, action: savedAction },
            'error syncing workflowStage'
          );
        }

        return Object.assign({}, savedAction, { result: savedRelease });
      } catch (err) {
        throw err;
      } finally {
        try {
          await lock.unlock();
        } catch (err) {
          this.log.error(
            { err },
            'could not release lock, but it will auto expire'
          );
        }
      }
    }

    default: {
      // Just save the action
      const now = getActionStatusTime(action) || new Date().toISOString();

      const handledAction = setId(
        handleUserReferences(
          handleParticipants(
            setDefaultActionStatusTime(action, now),
            graph,
            now
          ),
          graph
        ),
        createId('action', action, graph)
      );

      if (!sideEffects) {
        return handledAction;
      }

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      try {
        await this.syncGraph(graph, savedAction, { store });
      } catch (err) {
        this.log.error({ err, action: savedAction }, 'error syncing graphs');
      }

      try {
        await this.syncWorkflow(savedAction, { store });
      } catch (err) {
        this.log.error(
          { err, action: savedAction },
          'error syncing workflowStage'
        );
      }

      return savedAction;
    }
  }
}
