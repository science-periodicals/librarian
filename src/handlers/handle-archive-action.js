import { arrayify, getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import getScopeId from '../utils/get-scope-id';
import setId from '../utils/set-id';
import createId from '../create-id';
import handleParticipants from '../utils/handle-participants';
import { getObjectId } from '../utils/schema-utils';

// TODO archive Graph & journals ?

/**
 * Archive: WorkflowSpecification, Service and PublicationType
 */
export default async function handleArchiveAction(
  action,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  const objectId = getObjectId(action);
  if (!objectId) {
    throw createError(400, `{action['@type']} object must be defined`);
  }

  const object = await this.get(objectId, {
    store,
    acl: false
  });

  const scope = await this.get(getScopeId(object), {
    store,
    acl: false
  });

  switch (object['@type']) {
    case 'WorkflowSpecification': {
      // For WorkflowSpecification, be sure to update Periodical and remove the workflow from `potentialWorkflow`
      const [savedPeriodical, savedWorkflowSpecification] = await Promise.all([
        this.update(
          object,
          workflowSpecification => {
            return Object.assign({}, workflowSpecification, {
              workflowSpecificationStatus: 'ArchivedWorkflowSpecificationStatus'
            });
          },
          { store }
        ),
        this.update(
          scope,
          periodical => {
            const nextPeriodical = Object.assign({}, periodical, {
              potentialWorkflow: arrayify(periodical.potentialWorkflow).filter(
                potentialWorkflow => getId(potentialWorkflow) !== getId(object)
              )
            });
            if (!nextPeriodical.potentialWorkflow.length) {
              delete nextPeriodical.potentialWorkflow;
            }
            return nextPeriodical;
          },
          { store }
        )
      ]);

      const savedAction = await this.put(
        setId(
          handleParticipants(
            Object.assign(
              {
                startTime: new Date().toISOString()
              },
              action,
              {
                endTime: new Date().toISOString(),
                result: getId(savedWorkflowSpecification)
              }
            ),
            scope
          ),
          createId('action', action, scope)
        ),
        { store, force: true }
      );

      return Object.assign({}, savedAction, {
        result: savedWorkflowSpecification
      });
    }

    case 'PublicationType': {
      // For PublicationType, be sure to update Periodical and remove the type from `publicationTypeCoverage`
      const [savedPublicationType, savedPeriodical] = await Promise.all([
        this.update(
          object,
          publicationType => {
            return Object.assign({}, publicationType, {
              publicationTypeStatus: 'ArchivedPublicationTypeStatus'
            });
          },
          { store }
        ),
        this.update(
          scope,
          periodical => {
            const nextPeriodical = Object.assign({}, periodical, {
              publicationTypeCoverage: arrayify(
                periodical.publicationTypeCoverage
              ).filter(
                publicationType => getId(publicationType) !== getId(object)
              )
            });
            if (!nextPeriodical.publicationTypeCoverage.length) {
              delete nextPeriodical.publicationTypeCoverage;
            }
            return nextPeriodical;
          },
          { store }
        )
      ]);

      const savedAction = await this.put(
        setId(
          handleParticipants(
            Object.assign(
              {
                startTime: new Date().toISOString()
              },
              action,
              {
                endTime: new Date().toISOString(),
                result: getId(savedPublicationType)
              }
            ),
            scope
          ),
          createId('action', action, scope)
        ),
        { store, force: true }
      );

      return Object.assign({}, savedAction, {
        result: savedPublicationType
      });
    }

    case 'Service': {
      const savedService = await this.update(
        object,
        service => {
          return Object.assign({}, service, {
            serviceStatus: 'ArchivedServiceStatus'
          });
        },
        { store }
      );

      const savedAction = await this.put(
        setId(
          handleParticipants(
            Object.assign(
              {
                startTime: new Date().toISOString()
              },
              action,
              {
                endTime: new Date().toISOString(),
                result: getId(savedService)
              }
            ),
            scope
          ),
          createId('action', action, scope)
        ),
        { store, force: true }
      );

      return Object.assign({}, savedAction, {
        result: savedService
      });
    }

    default:
      throw createError(400, `Invalid object @type for ${action['@type']}`);
  }
}
