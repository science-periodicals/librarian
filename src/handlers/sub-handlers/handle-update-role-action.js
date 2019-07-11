import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, dearrayify, arrayify } from '@scipe/jsonld';
import { handleOverwriteUpdate } from '../../utils/pouch';
import handleParticipants from '../../utils/handle-participants';
import createId from '../../create-id';
import setId from '../../utils/set-id';
import { validateOverwriteUpdate } from '../../validators';
import { getTargetCollectionId } from '../../utils/schema-utils';

export default async function handleUpdateRoleAction(
  action,
  role,
  { store, triggered, prevAction, mode }
) {
  // find role to update
  let roleProp;
  const scopeId = getId(role.isNodeOf);
  if (!scopeId) {
    throw createError(
      500,
      `Could not find scope associated with role ${getId(role)}`
    );
  }

  const scope = await this.get(scopeId, {
    store,
    acl: false
  });

  if (scope['@type'] !== 'Periodical' && scope['@type'] !== 'Organization') {
    throw createError(
      403,
      `UpdateAction targeting role can only update role of Periodical or Organization not ${
        scope['@type']
      }`
    );
  }

  const props = [
    'author',
    'reviewer',
    'editor',
    'producer',
    'contributor',
    'member'
  ];
  for (let p of props) {
    role = arrayify(scope[p]).find(
      role => getId(role) === getTargetCollectionId(action)
    );
    if (role) {
      roleProp = p;
      break;
    }
  }

  if (!role) {
    throw createError(
      500,
      `Could not find role ${getTargetCollectionId(action)} in scope ${getId(
        scope
      )}`
    );
  }

  const messages = validateOverwriteUpdate(
    role,
    action.object,
    action.targetCollection.hasSelector,
    {
      immutableProps: [
        '_id',
        '@id',
        '_rev',
        'roleName',
        'startDate',
        'endDate',
        'potentialAction',
        'creator',
        'author',
        'contributor',
        'editor',
        'producer',
        'reviewer',
        'roleContactPoint'
      ]
    }
  );

  if (messages.length) {
    throw createError(400, messages.join(' '));
  }

  switch (action.actionStatus) {
    case 'CompletedActionStatus': {
      let updatedRole;

      const savedScope = await this.update(
        scope,
        scope => {
          const role = arrayify(scope[roleProp]).find(
            role => getId(role) === getTargetCollectionId(action)
          );

          updatedRole = handleOverwriteUpdate(
            role,
            action.object,
            action.targetCollection.hasSelector
          );

          return Object.assign(
            {},
            scope,
            {
              [roleProp]: dearrayify(
                scope[roleProp],
                arrayify(scope[roleProp]).map(role => {
                  if (getId(role) === getId(updatedRole)) {
                    return updatedRole;
                  }
                  return role;
                })
              )
            },
            scope['@type'] === 'Periodical'
              ? { dateModified: new Date().toISOString() }
              : undefined
          );
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
              result: pick(updatedRole, ['@id', '@type']) // for convenience for changes feed processing
            }
          ),
          savedScope
        ),
        createId('action', action, savedScope)
      );

      const savedAction = await this.put(handledAction, {
        force: true,
        store
      });

      return Object.assign({}, savedAction, {
        result: mode === 'document' ? savedScope : updatedRole
      });
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
