import pick from 'lodash/pick';
import { parseIndexableString } from '@scipe/collate';
import createError from '@scipe/create-error';
import { getId, arrayify } from '@scipe/jsonld';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import {
  validateOverwriteUpdate,
  validateStylesAndAssets
} from '../../validators';
import getScopeId from '../../utils/get-scope-id';
import { getEmbeddedIssuePart, setEmbeddedIds } from '../../utils/embed-utils';

// TODO validate / enforce that workFeatured only contains entry compatible with the time coverage

export default async function handleUpdateSpecialPublicationIssueAction(
  action,
  issue,
  { store, triggered, prevAction, strict }
) {
  const [scopeId] = parseIndexableString(issue._id);

  // scope is periodical for issues
  const scope = await this.get(scopeId, {
    store,
    acl: false
  });

  action = await this.validateAndSetupNodeIds(action, {
    store,
    strict,
    prevEmbedderDoc: issue
  });

  const messages = validateOverwriteUpdate(
    issue,
    action.object,
    action.targetCollection.hasSelector,
    {
      arrayProps: ['workFeatured', 'logo', 'image', 'audio', 'video'],
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'url',
        'potentialAction',
        'dateCreated',
        'dateModified',
        'creator',
        'author',
        'reviewer',
        'contributor',
        'editor',
        'producer',
        'hasDigitalDocumentPermission',
        'mainEntityOfPage',
        'temporalCoverage'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  let updatePayload = action.object; // !we do _not_ unrole as the update payload can be anything

  // more validation
  const updatedProps =
    action.targetCollection &&
    action.targetCollection.hasSelector &&
    action.targetCollection.hasSelector.selectedProperty
      ? [action.targetCollection.hasSelector.selectedProperty]
      : Object.keys(updatePayload);

  // validate that if `hasPart` is set, it points to existing articles and that hasPart is specified as scope and not version
  if (updatedProps.includes('hasPart')) {
    const parts =
      action.targetCollection &&
      action.targetCollection.hasSelector &&
      action.targetCollection.hasSelector.selectedProperty
        ? updatePayload
        : updatePayload.hasPart;

    if (parts != null) {
      if (
        arrayify(parts).some(
          part =>
            getId(part) !==
            `${createId('graph', getScopeId(part))['@id']}?version=latest`
        )
      ) {
        throw createError(
          400,
          `${
            action['@type']
          }: invalid value for hasPart. hasPart must be updated with latest graph @id (?version=latest) of graphs belonging to the Periodical`
        );
      }

      // Check that latest version of those scope exists and belong to the righ periodical
      const latestReleases = await this.get(
        arrayify(parts).map(
          part => createId('release', 'latest', getScopeId(part), true)._id
        ),
        { store, acl: false }
      );

      if (
        latestReleases.length !== parts.length ||
        latestReleases.some(release => !release.datePublished)
      ) {
        throw createError(
          400,
          `${
            action['@type']
          }: invalid value for hasPart. hasPart must be updated with latest graph @id (?version=latest) of published graphs belonging to the Periodical`
        );
      }

      // we partially embed releases into hasPart for convenience
      updatePayload = Object.assign({}, updatePayload, {
        hasPart: latestReleases.map(release => getEmbeddedIssuePart(release))
      });
    }
  }

  // TODO more validation:
  // - for workFeatured we ensure that the release exists and that their @id is ?version=latest

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedIssue = await this.update(
        issue,
        issue => {
          const updatedIssue = setEmbeddedIds(
            handleOverwriteUpdate(
              issue,
              updatePayload,
              action.targetCollection.hasSelector
            )
          );

          updatedIssue.dateModified = new Date().toISOString();

          const messages = validateStylesAndAssets(updatedIssue);
          if (messages.length) {
            throw createError(400, messages.join(' ; '));
          }

          return updatedIssue;
        },
        { store, ifMatch: action.ifMatch }
      );

      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {
              endTime: new Date().toISOString()
            },
            action,
            {
              result: pick(savedIssue, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          scope
        ),
        createId('action', action, scope)
      );

      const savedAction = await this.put(handledAction, {
        store,
        force: true
      });

      if (updatedProps.includes('hasPart')) {
        try {
          await this.syncIssue(savedIssue, { store });
        } catch (err) {
          this.log.error(
            { err, action: savedAction, issue: savedIssue },
            'error syncing issue'
          );
        }
      }

      return Object.assign({}, savedAction, { result: savedIssue });
    }

    default: {
      const handledAction = setId(
        handleParticipants(
          Object.assign(
            {},
            action.actionStatus !== 'PotentialActionStatus'
              ? {
                  startTime: new Date().toISOString()
                }
              : undefined,
            action.actionStatus === 'StagedActionStatus'
              ? { stagedTime: new Date().toISOString() }
              : undefined,
            action.actionStatus === 'FailedActionStatus'
              ? {
                  endTime: new Date().toISOString()
                }
              : undefined,
            action
          ),
          scope
        ),
        createId('action', action, scope)
      );

      return this.put(handledAction, {
        store,
        force: true
      });
    }
  }
}
