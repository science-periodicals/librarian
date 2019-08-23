import omit from 'lodash/omit';
import uniqBy from 'lodash/uniqBy';
import url from 'url';
import slug from 'slug';
import isUrl from 'is-url';
import pick from 'lodash/pick';
import pickBy from 'lodash/pickBy';
import { unprefix, getId, arrayify, getNodeMap } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { getObjectId, getRootPartId, getResultId } from '../utils/schema-utils';
import getScopeId from '../utils/get-scope-id';
import setId from '../utils/set-id';
import handleParticipants from '../utils/handle-participants';
import handleUserReferences from '../utils/handle-user-references';
import {
  validateDateTimeDuration,
  validateStylesAndAssets
} from '../validators';
import createId from '../create-id';
import { isEqualDigitalDocumentPermission, normalizePermissions } from '../acl';
import { versionNodes } from '../utils/blob-utils';
import {
  addPublicAudience,
  getActionStatusTime,
  setDefaultActionStatusTime
} from '../utils/workflow-utils';
import { getTemplateId } from '../utils/workflow-actions';
import { DOI_REGISTRATION_SERVICE_TYPE } from '../constants';
import { setEmbeddedIds } from '../utils/embed-utils';
import { endGraphRoles } from '../utils/role-utils';

// TODO do not allow to complete the PublishAction if there are pending CheckActions (add logic to ensureWorkflowCompliance method)

// TODO? compute NaSH on the _anonymized_ release (from the perspective of public user)

/**
 * A PublishAction must be part of a workflow
 */
export default async function handlePublishAction(
  action,
  {
    store,
    triggered,
    prevAction,
    skipPayments,
    strict,
    sideEffects = true
  } = {},
  callback
) {
  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must point to a Graph`);
  }

  const graphId = getScopeId(objectId);
  const graph = await this.get(graphId, {
    store,
    acl: false
  });

  const periodicalId = getRootPartId(graph);
  if (!periodicalId) {
    return callback(createError(500, 'could not find periodicalId'));
  }

  const periodical = await this.get(periodicalId, {
    acl: false,
    store
  });

  // Note `ensureWorkflowCompliance` takes care of ensuring that action.result `@id`, `@type` and `version` are properly set
  action = await this.ensureWorkflowCompliance(action, prevAction, graph, {
    triggered,
    store
  });

  // Validate slug
  const allocatedSlug =
    (action.result && action.result.slug) || unprefix(getId(graph));

  if (
    typeof allocatedSlug !== 'string' ||
    allocatedSlug !== slug(allocatedSlug, { symbols: false, lower: false })
  ) {
    throw createError(400, `Invalid slug`);
  }

  // Validate datePublished (used for scheduling)
  const now = getActionStatusTime(action) || new Date().toISOString();
  const datePublished = (action.result && action.result.datePublished) || now;

  const messages = validateDateTimeDuration({ datePublished });
  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  // lock to ensure slug uniqueness need to take into account other (active and completed) PublishAction as well
  const lock = await this.createLock(allocatedSlug, {
    isLocked: async () => {
      const hasUniqId = await this.hasUniqId(allocatedSlug);
      const publishActions = await this.getPublishActionsBySlug(allocatedSlug, {
        store
      });

      return (
        hasUniqId ||
        publishActions.some(_action => getId(_action) !== getId(action))
      );
    },
    prefix: 'publish'
  });

  let payload;
  try {
    switch (action.actionStatus) {
      case 'CompletedActionStatus': {
        // Note: we make sure that the mainEntityOfPage (if defined) is first
        // (mainEntityOfPage point to the journal external (non sci.pe) custom
        // domain)
        let releaseUrl;
        const urls = arrayify(periodical.mainEntityOfPage)
          .concat(periodical.url)
          .filter(uri => isUrl(uri));

        if (urls.length) {
          releaseUrl = url.resolve(urls[0], allocatedSlug);
        }

        const publicVersion = action.result.version;

        let publicRelease = endGraphRoles(
          versionNodes(
            setId(
              pickBy(
                addPublicPermissions(
                  Object.assign(
                    {
                      '@type': 'Graph'
                    },
                    omit(graph, [
                      '_id',
                      '@id',
                      '_rev',
                      '@lucene',
                      'potentialAction'
                    ]),
                    {
                      version: publicVersion,
                      datePublished,
                      slug: allocatedSlug
                    },
                    releaseUrl ? { url: releaseUrl } : undefined
                  ),
                  {
                    publicAudiences: action.publishIdentityOf,
                    datePublished
                  }
                ),
                x => x !== undefined
              ),
              createId('release', publicVersion, graph, true) // we specify `true` as last argument so that the _id is latest instead of the version (=> will be indexed in lucene)
            )
          ),
          {
            now: now // Note: not `datePublished` as it can be in the far future (or past)
          }
        );

        if (arrayify(action.addOnService).length) {
          const addOnServices = await this.get(arrayify(action.addOnService), {
            needAll: true,
            acl: false,
            store
          });

          if (
            addOnServices.some(
              service => service.serviceType === DOI_REGISTRATION_SERVICE_TYPE
            )
          ) {
            // In case there is an `addOnService` for DOI registration we add DOIs
            // Note that `registerDois` return a new `graph` / `publicRelease` but with new `doi` props
            // `registerDois` is safe to retry so we do it first and _before_ computing the NaSH
            if (sideEffects) {
              publicRelease = await this.registerDois(publicRelease, { store });
            }
          }
        }

        // we add the NaSH now (need to be called after `registerDois` when `registerDois` is called)
        publicRelease = await this.createNash(publicRelease);
        publicRelease = setEmbeddedIds(publicRelease);

        // Note: we don't revalidate the node (`validateAndSetupNodeIds`) as they
        // were already validated when updating the Graph
        const messages = validateStylesAndAssets(publicRelease);
        if (messages.length) {
          throw createError(400, messages.join(' ; '));
        }

        const handledAction = handleUserReferences(
          handleParticipants(
            Object.assign(
              {
                endTime: now // Note: the endTime is _not_ the `datePublished` so that the notifications are "real time" (date published can be in far future)
              },
              arrayify(action.publishActionInstanceOf).some(
                templateId => getTemplateId(action) === getId(templateId)
              )
                ? addPublicAudience(action, { now: datePublished })
                : action,
              {
                // we partially embed the result so that app-suite can display the added values (slug, datePublished...)
                result: pick(publicRelease, [
                  '@id',
                  '@type',
                  'slug',
                  'version',
                  'datePublished'
                ])
              }
            ),
            graph,
            now
          ),
          graph
        );

        const latestReleaseId = createId('release', 'latest', graph)['@id'];

        let release;
        try {
          release = await this.get(latestReleaseId, {
            store,
            acl: false
          });
        } catch (err) {
          if (err.code !== 404) {
            throw err;
          }
        }

        if (release) {
          if (getId(release) === getId(publicRelease)) {
            // this can happen during retries, in this case we treat `release` as
            // the `publicRelease` so that there are not 2 releases with the same
            // version
            publicRelease._rev = release._rev;
            release = undefined; // needs to be `undefined` (not `null`) so that it works with arrayify
          } else {
            publicRelease._rev = release._rev;
            release = Object.assign(
              omit(release, ['_id', '_rev']), // release will be a new document
              createId('release', release.version, graph) // _id had `latest` instead of the specific version previously, we now set it to the specific version
            );
          }
        }

        // add the matching chronological PublicationIssue (if any)
        try {
          const issueId = await this.getLatestReleasePublicationIssueId(
            publicRelease,
            { store }
          );
          if (issueId) {
            // be sure to replace journal entry by the issue one if a journal entry exists
            publicRelease.isPartOf = arrayify(publicRelease.isPartOf)
              .filter(
                _issue =>
                  getId(_issue) !== issueId && getId(_issue) !== periodicalId
              )
              .concat({ '@id': issueId, isPartOf: periodicalId });

            if (publicRelease.isPartOf.length === 1) {
              publicRelease.isPartOf = publicRelease.isPartOf[0];
            }
          }
        } catch (err) {
          this.log.error({ err }, 'getLatestReleasePublicationIssueId errored');
        }

        // flag the action listed in `publishActionInstanceOf` (and the associated
        // releases in case of CreateReleaseAction) as public.
        // Note we also make public the `object` _and_ the `instrument` of the actions
        // flagged as public so that the UI makes sense (e.g a ReviewAction without
        // a public `object` is kind of a non-sense from the review reader perspective
        let releasesToPublish, releaseWillBePublished;
        const templateIds = arrayify(
          handledAction.publishActionInstanceOf
        ).filter(
          templateId => getId(templateId) !== getTemplateId(handledAction)
        );

        // we make sure that `StartWorkflowStageAction` are always made public as
        // publisher needs them to bootstrap the app
        let actionsToPublish = await this.getActionsByScopeIdAndTypes(
          graphId,
          ['StartWorkflowStageAction'],
          { store }
        );

        if (templateIds.length) {
          const actions = await this.getActionsByTemplateIdsAndScopeId(
            templateIds,
            graphId,
            {
              store
            }
          );

          // we get the `instrument` so that everything needed to read an action
          // is available
          const actionMap = getNodeMap(actions);
          const extraActionIdsToFetch = [];
          actions.forEach(action => {
            arrayify(action.instrument).forEach(instrument => {
              const instrumentId = getId(instrument);
              if (!(instrumentId in actionMap)) {
                extraActionIdsToFetch.push(instrumentId);
              }
            });
          });

          let extraActions = [];
          if (extraActionIdsToFetch.length) {
            extraActions = await this.get(extraActionIdsToFetch, {
              acl: false,
              store
            });
          }
          actionsToPublish.push(...actions, ...extraActions);
        }

        actionsToPublish = uniqBy(
          actionsToPublish.map(action =>
            handleParticipants(
              addPublicAudience(action, { now: datePublished }),
              graph,
              now
            )
          ),
          getId
        );

        let releaseIdsToPublish = actionsToPublish
          .filter(action => action['@type'] === 'CreateReleaseAction')
          .map(action => getResultId(action))
          .filter(Boolean);

        if (releaseIdsToPublish.length) {
          if (
            releaseIdsToPublish.some(releaseId => releaseId === getId(release))
          ) {
            releasesToPublish = [release];
            releaseWillBePublished = true;
            const releaseIdsToFetch = releaseIdsToPublish.filter(
              releaseId => releaseId !== getId(release)
            );
            if (releaseIdsToFetch.length) {
              const fetched = await this.get(releaseIdsToFetch, {
                acl: false,
                store
              });
              releasesToPublish.push(...fetched);
            }
          } else {
            releasesToPublish = await this.get(releaseIdsToPublish, {
              acl: false,
              store
            });
          }

          releasesToPublish = releasesToPublish.map(release => {
            return addPublicPermissions(release, {
              publicAudiences: handledAction.publishIdentityOf,
              datePublished
            });
          });
        }

        if (!sideEffects) {
          return handledAction;
        }

        // need to be called when action is handled but _before_ it is saved or
        // side effects are executed so it can be easily retried if failures
        await this.createCharge(handledAction, { store, skipPayments });
        await this.createUsageRecord(handledAction, { store, skipPayments });
        await this.createInvoiceItem(handledAction, { store, skipPayments });

        const [savedAction, savedPublicRelease, ...others] = await this.put(
          [handledAction, publicRelease]
            .concat(releaseWillBePublished ? [] : arrayify(release)) // `release` may be undefined
            .concat(arrayify(releasesToPublish)) // `releasesToPublish` may be undefined
            .concat(arrayify(actionsToPublish)), // `actionsToPublish` may be undefined
          { force: true, store }
        );

        // make the graph public so that permission work
        try {
          const syncedGraph = await this.syncGraph(
            graph,
            [savedAction].concat(others),
            {
              store,
              endRoles: true,
              now,
              updatePayload: Object.assign(
                pick(publicRelease, [
                  'datePublished',
                  'slug',
                  'hasDigitalDocumentPermission' // we make the live graph public as well
                ]),
                savedPublicRelease.identifier != null
                  ? {
                      identifier: savedPublicRelease.identifier + 1
                    }
                  : undefined,
                { dateEnded: now }
              )
            }
          );
        } catch (err) {
          this.log.error({ err, action: savedAction }, 'error syncing graphs');
        }

        try {
          await this.syncWorkflow([savedAction].concat(others), { store });
        } catch (err) {
          this.log.error(
            { err, action: savedAction },
            'error syncing workflowStage'
          );
        }

        payload = Object.assign({}, savedAction, {
          result: savedPublicRelease
        });
        break;
      }

      default: {
        const handledAction = handleUserReferences(
          handleParticipants(
            setDefaultActionStatusTime(action, now),
            graph,
            now
          ),
          graph
        );

        if (!sideEffects) {
          return handledAction;
        }

        const savedAction = await this.put(handledAction, {
          force: true,
          store
        });

        payload = savedAction;

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

        break;
      }
    }
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

  return payload;
}

function addPublicPermissions(
  release,
  { publicAudiences = [], datePublished }
) {
  publicAudiences = arrayify(publicAudiences)
    .filter(audience => audience.audienceType)
    .map(audience => pick(audience, ['@type', 'audienceType']));

  const permissions = arrayify(
    normalizePermissions(release).hasDigitalDocumentPermission
  );

  const addedPermissions = arrayify(
    normalizePermissions({
      hasDigitalDocumentPermission: [
        // public read access
        {
          '@type': 'DigitalDocumentPermission',
          permissionType: 'ReadPermission',
          grantee: { '@type': 'Audience', audienceType: 'public' },
          validFrom: datePublished
        }
      ].concat(
        // potentialy remove blinding
        publicAudiences.length
          ? [
              {
                '@type': 'DigitalDocumentPermission',
                permissionType: 'ViewIdentityPermission',
                grantee: { '@type': 'Audience', audienceType: 'public' },
                permissionScope: publicAudiences,
                validFrom: datePublished
              }
            ]
          : []
      )
    }).hasDigitalDocumentPermission
  ).filter(permission => {
    return !permissions.some(_permission =>
      isEqualDigitalDocumentPermission(permission, _permission)
    );
  });

  return Object.assign({}, release, {
    hasDigitalDocumentPermission: permissions.concat(addedPermissions)
  });
}
