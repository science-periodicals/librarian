import isPlainObject from 'lodash/isPlainObject';
import { getId, arrayify, dearrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createId from '../create-id';
import schema from '../utils/schema';
import setId from '../utils/set-id';
import { getObjectId } from '../utils/schema-utils';
import { validateAndSetupPublicationTypeObjectSpecification } from '../utils/workflow-actions';
import { setEmbeddedIds } from '../utils/embed-utils.js';
import {
  validateStylesAndAssets,
  validateDateTimeDuration
} from '../validators';

/**
 * Create a PublicationType.
 * PublicationType contains an `objectSpecification` stored as a flattenned graph
 */
export default async function handleCreatePublicationTypeAction(
  action,
  { store, triggered, prevAction }
) {
  // Custom types are scoped within periodical. We considered scoping them to
  // Organization but decided against it to bias toward Journal specific article
  // types
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const periodicalId = getObjectId(action);
  const periodical = await this.get(periodicalId, {
    acl: false,
    node: false,
    store
  });
  if (!schema.is(periodical, 'Periodical')) {
    throw createError(400, 'Invalid object for CreatePublicationTypeAction');
  }

  let objectSpecification = action.result && action.result.objectSpecification;
  let handledObjectSpecification;
  if (objectSpecification) {
    handledObjectSpecification = await validateAndSetupPublicationTypeObjectSpecification(
      objectSpecification
    );
  }

  let handledEligibleWorkflow;
  const eligibleWorkflow = action.result && action.result.eligibleWorkflow;
  if (arrayify(eligibleWorkflow).length) {
    let workflows;
    try {
      workflows = await this.get(eligibleWorkflow, {
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
      arrayify(workflows).length !== arrayify(eligibleWorkflow).length ||
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

    handledEligibleWorkflow = dearrayify(
      eligibleWorkflow,
      arrayify(workflows)
        .map(getId)
        .filter(Boolean)
        .map(id => id.split('?')[0]) // remove the `?version=`
    );
  }

  const publicationType = setEmbeddedIds(
    setId(
      Object.assign(
        {
          '@type': 'PublicationType',
          dateCreated: new Date().toISOString()
        },
        isPlainObject(action.result)
          ? Object.assign(
              {},
              action.result,
              handledObjectSpecification
                ? {
                    objectSpecification: handledObjectSpecification
                  }
                : undefined,
              handledEligibleWorkflow
                ? {
                    eligibleWorkflow: handledEligibleWorkflow
                  }
                : undefined
            )
          : undefined,
        { isPublicationTypeOf: periodicalId }
      ),
      createId('type', getId(action.result), periodicalId)
    )
  );

  const messages = validateStylesAndAssets(publicationType).concat(
    validateDateTimeDuration(publicationType)
  );
  if (messages.length) {
    throw createError(400, messages.join(' ; '));
  }

  action = Object.assign(
    createId('action', getId(action), getId(periodical)),
    {
      startTime: new Date().toISOString(),
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString()
    },
    action,
    {
      result: publicationType
    }
  );

  const [savedAction, savedPublicationType] = await this.put(
    [action, publicationType],
    { force: true, store }
  );

  const updatedPeriodical = this.update(
    periodical,
    periodical => {
      if (
        !arrayify(periodical.publicationTypeCoverage).some(
          type => getId(type) === getId(savedPublicationType)
        )
      ) {
        periodical = Object.assign({}, periodical, {
          publicationTypeCoverage: arrayify(
            periodical.publicationTypeCoverage
          ).concat(getId(savedPublicationType))
        });
      }
      return periodical;
    },
    { store, ifMatch: action.ifMatch }
  );

  return Object.assign(savedAction, { result: savedPublicationType });
}
