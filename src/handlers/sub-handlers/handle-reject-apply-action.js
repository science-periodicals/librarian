import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { getId, arrayify } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import findRole from '../../utils/find-role';
import remapRole from '../../utils/remap-role';
import handleParticipants from '../../utils/handle-participants';
import setId from '../../utils/set-id';
import createId from '../../create-id';
import { getObjectId } from '../../utils/schema-utils';

/**
 * Used to reject an `ApplyAction` (`object`) by completing it and setting the
 * RejectAction as result of the `ApplyAction`
 */
export default async function handleRejectApplyAction(
  action,
  applyAction,
  { store, triggered, prevAction } = {}
) {
  if (action.actionStatus !== 'CompletedActionStatus') {
    throw createError(
      400,
      `${action['@type']} actionStatus must be CompletedActionStatus`
    );
  }

  if (applyAction.actionStatus !== 'ActiveActionStatus') {
    throw createError(
      400,
      `Invalid object for ${
        action['@type']
      }. object must be an ApplyAction in ActiveActionStatus status (got ${
        applyAction.actionStatus
      })`
    );
  }

  const object = await this.get(getObjectId(applyAction), {
    store,
    acl: false
  });

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(
            findRole(action.agent, object, {
              ignoreEndDateOnPublicationOrRejection: true
            }) || action.agent,
            'agent'
          ),
          result: getId(applyAction)
        }
      ),
      object
    ),
    createId('action', action, object)
  );

  const handledApplyAction = handleParticipants(
    Object.assign({}, applyAction, {
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString(),
      // Note: we partially embedd the object has the user will loose access to the object => won't be able to see proper notification
      object: pick(object, [
        '@id',
        '@type',
        'name',
        'alternateName',
        'isPartOf',
        'publisher'
      ]),
      result: omit(handledAction, ['_id', '_rev']), // full RejectAction,
      // Note: we embed the RejectAction in the potential action so we know if invite was accepted or rejected for notification
      potentialAction: arrayify(applyAction.potentialAction)
        .filter(action => getId(action) !== getId(handledAction))
        .concat(
          pick(handledAction, [
            '@id',
            '@type',
            'actionStatus',
            'startTime',
            'endTime'
          ])
        )
    }),
    object
  );

  const [savedAction, savedApplyAction] = await this.put(
    [handledAction, handledApplyAction],
    { force: true, store }
  );

  return Object.assign({}, savedAction, {
    result: savedApplyAction
  });
}
