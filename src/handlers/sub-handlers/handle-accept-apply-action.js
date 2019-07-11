import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { getId, arrayify, reUuid, unprefix } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import remapRole from '../../utils/remap-role';
import handleParticipants from '../../utils/handle-participants';
import setId from '../../utils/set-id';
import createId from '../../create-id';
import findRole from '../../utils/find-role';
import { getObjectId } from '../../utils/schema-utils';

/**
 * Used to accept an `ApplyAction`  (the `object`)
 * Note: we know that the InviteAction is valid so we go straight to side effects
 */
export default async function handleAcceptApplyAction(
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

  // if a role @id was set ahead of time we preserve it.
  // This is required for stories
  const roleId = getId(applyAction.agent);
  const roleProp = applyAction.agent.roleName;
  const addedRole = setId(
    Object.assign(
      {},
      remapRole(applyAction.agent, roleProp, {
        dates: false
      }),
      {
        startDate: new Date().toISOString()
      }
    ),
    createId(
      'role',
      roleId && roleId.startsWith('role:') && reUuid.test(unprefix(roleId))
        ? roleId
        : null
    )
  );

  const savedObject = await this.update(
    object,
    object => {
      return Object.assign({}, object, {
        [roleProp]: arrayify(object[roleProp]).concat(
          findRole(omit(applyAction.action, ['@id']), object, {
            ignoreEndDateOnPublicationOrRejection: true
          })
            ? [] // for whatever reason (for instance a JoinAction) the role was already added => noop
            : addedRole
        )
      });
    },
    { store }
  );

  const handledAction = setId(
    handleParticipants(
      Object.assign(
        {
          endTime: new Date().toISOString()
        },
        action,
        {
          agent: remapRole(
            findRole(action.agent, savedObject, {
              ignoreEndDateOnPublicationOrRejection: true
            }) || action.agent,
            'agent'
          ),
          result: getId(savedObject)
        }
      ),
      savedObject
    ),
    createId('action', action, savedObject)
  );

  const handledApplyAction = handleParticipants(
    Object.assign({}, applyAction, {
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString(),
      result: getId(savedObject),
      // Note: we embed AcceptAction and RejectAction in the potential action so we know if invite was accepted or rejected for notification
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
    savedObject
  );

  const [savedAction, savedApplyAction] = await this.put(
    [handledAction, handledApplyAction],
    { force: true, store }
  );

  await this.syncParticipants(savedObject, { store });

  return Object.assign({}, savedAction, {
    result: Object.assign({}, savedApplyAction, { result: savedObject })
  });
}
