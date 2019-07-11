import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { validateOverwriteUpdate } from '../../validators';
import getScopeId from '../../utils/get-scope-id';
import { validateAndSetupPublicationTypeObjectSpecification } from '../../utils/workflow-actions';
import { setEmbeddedIds } from '../../utils/embed-utils.js';

/**
 * Note: `PublicationType` can list `eligibleWorkflow` but we don't auto
 * update that list if workflows are archived
 */
export default async function handleUpdatePublicationTypeAction(
  action,
  publicationType,
  { store, triggered, prevAction }
) {
  const periodicalId = getScopeId(publicationType);

  const messages = validateOverwriteUpdate(
    publicationType,
    action.object,
    action.targetCollection.hasSelector,
    {
      arrayProps: ['logo', 'image', 'audio', 'video', 'eligibleWorkflow'],
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        '@type',
        'publicationTypeStatus',
        'dateCreated'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  const scope = await this.get(periodicalId, {
    acl: false,
    store
  });

  const nextPublicationType = handleOverwriteUpdate(
    publicationType,
    action.object,
    action.targetCollection.hasSelector
  );

  // validate objectSpecification
  if (nextPublicationType.objectSpecification) {
    try {
      await validateAndSetupPublicationTypeObjectSpecification(
        nextPublicationType.objectSpecification
      );
    } catch (err) {
      throw createError(
        400,
        `${action['@type']} results in an invalid objectSpecification`
      );
    }
  }

  // validate `eligibleWorkflow`
  // listed workflows must be from the journal but we don't care about their
  // status or if they have been archived
  if (arrayify(nextPublicationType.eligibleWorkflow).length) {
    let workflows;
    try {
      workflows = await this.get(nextPublicationType.eligibleWorkflow, {
        acl: false,
        store
      });
    } catch (err) {
      if (err.code === 404) {
        throw createError(
          400,
          `${action['@type']}: eligible workflow cannot be found`
        );
      }
      throw err;
    }

    if (
      arrayify(workflows).length !==
        arrayify(nextPublicationType.eligibleWorkflow).length ||
      arrayify(workflows).some(
        workflow => getId(workflow.isPotentialWorkflowOf) !== periodicalId
      )
    ) {
      throw createError(
        400,
        `${
          action['@type']
        }: invalid eligible workflow property, all workflow must be associated with the journal ${periodicalId}`
      );
    }
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      const savedPublicationType = await this.update(
        publicationType,
        async publicationType => {
          const nextPublicationType = handleOverwriteUpdate(
            publicationType,
            action.object,
            action.targetCollection.hasSelector
          );
          nextPublicationType.dateModified = new Date().toISOString();

          if (nextPublicationType.objectSpecification) {
            nextPublicationType.objectSpecification = await validateAndSetupPublicationTypeObjectSpecification(
              nextPublicationType.objectSpecification
            );
          }

          if (nextPublicationType.eligibleWorkflow) {
            // sanitize
            nextPublicationType.eligibleWorkflow = dearrayify(
              nextPublicationType.eligibleWorkflow,
              arrayify(nextPublicationType.eligibleWorkflow)
                .map(getId)
                .filter(Boolean)
                .map(id => id.split('?')[0]) // remove the `?version=`
            );
          }

          return setEmbeddedIds(nextPublicationType);
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
              result: pick(savedPublicationType, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          scope
        ),
        createId('action', action, scope)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, { result: savedPublicationType });
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
        force: true,
        store
      });
    }
  }
}
