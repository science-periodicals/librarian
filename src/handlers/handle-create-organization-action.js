import isPlainObject from 'lodash/isPlainObject';
import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { getId, unrole, arrayify } from '@scipe/jsonld';
import createId from '../create-id';
import {
  CONTACT_POINT_ADMINISTRATION,
  CONTACT_POINT_GENERAL_INQUIRY,
  ORGANIZATION_ADMIN_ROLE_NAME
} from '../constants';
import setId from '../utils/set-id';
import { getAgentId } from '../utils/schema-utils';
import { setEmbeddedIds } from '../utils/embed-utils';
import { validateStylesAndAssets } from '../validators';

export default async function handleCreateOrganizationAction(
  action,
  { store, triggered } = {}
) {
  const agentId = getAgentId(action.agent);
  if (!agentId || !agentId.startsWith('user:')) {
    throw createError(400, 'CreateOrganizationAction must have a valid agent');
  }

  let organization = unrole(action.result, 'result');
  const organizationId = getId(organization);
  if (
    !organizationId ||
    organizationId !== createId('org', organizationId)['@id']
  ) {
    throw createError(
      400,
      'CreateOrganizationAction must have result property indicating the organization @id'
    );
  }

  if (!isPlainObject(organization)) {
    organization = { '@id': organizationId };
  }

  // Members must be `ORGANIZATION_ADMIN_ROLE_NAME` or `producer` of `@type` `ServiceProviderRole` (needed for TypesettingActions)
  if (
    arrayify(organization.member).some(member => {
      return (
        !(
          member.roleName === ORGANIZATION_ADMIN_ROLE_NAME ||
          (member.roleName === 'producer' &&
            member['@type'] === 'ServiceProviderRole')
        ) || getAgentId(member) !== agentId
      );
    })
  ) {
    throw createError(
      400,
      `CreateOrganizationAction result.member must only list member of @type ContributorRole and roleName ${ORGANIZATION_ADMIN_ROLE_NAME} or @type ServiceProviderRole and roleName producer with user id equal to the agent ${agentId}`
    );
  }

  // we ensure that `agent` is the `ORGANIZATION_ADMIN_ROLE_NAME`
  const admin = arrayify(organization.member).find(
    member => member.roleName === ORGANIZATION_ADMIN_ROLE_NAME
  ) || {
    '@type': 'ContributorRole',
    roleName: ORGANIZATION_ADMIN_ROLE_NAME,
    member: agentId
  };

  // cleanup `ServiceProviderRole`
  const producers = arrayify(organization.member)
    .filter(member => member.roleName === 'producer')
    .map(member =>
      Object.assign(pick(member, ['@id', '@type', 'roleName', 'name']), {
        member: agentId
      })
    );

  // we get the profile so that we can set default email for the contact point
  const profile = await this.get(agentId, { acl: false, store });
  const adminContactPoint = arrayify(profile.contactPoint).find(
    contactPoint => contactPoint.contactType === CONTACT_POINT_ADMINISTRATION
  );
  const generalContactPoint = arrayify(profile.contactPoint).find(
    contactPoint => contactPoint.contactType === CONTACT_POINT_GENERAL_INQUIRY
  );

  if (!adminContactPoint) {
    throw createError(
      500,
      `${
        action['@type']
      }: could not find ${CONTACT_POINT_ADMINISTRATION} in ${agentId} profile`
    );
  }
  if (!generalContactPoint) {
    throw createError(
      500,
      `${
        action['@type']
      }: could not find ${CONTACT_POINT_GENERAL_INQUIRY} in ${agentId} profile`
    );
  }

  organization = setEmbeddedIds(
    Object.assign(
      {},
      organization,
      createId('org', organizationId),
      // we ALWAYS overwite some props: @type, contactPoint and member
      {
        '@type': 'Organization',
        canReceivePayment: false,
        // We set ALL possible contact points taking default value from the agent profile
        contactPoint: [
          {
            '@id': createId(
              'contact',
              CONTACT_POINT_ADMINISTRATION,
              organizationId
            )['@id'],
            '@type': 'ContactPoint',
            contactType: CONTACT_POINT_ADMINISTRATION,
            email: adminContactPoint.email,
            verificationStatus: adminContactPoint.verificationStatus
          },
          {
            '@id': createId(
              'contact',
              CONTACT_POINT_GENERAL_INQUIRY,
              organizationId
            )['@id'],
            '@type': 'ContactPoint',
            contactType: CONTACT_POINT_GENERAL_INQUIRY,
            email: generalContactPoint.email,
            verificationStatus: generalContactPoint.verificationStatus
          }
        ],
        customerAccountStatus: 'PotentialCustomerAccountStatus',
        founder: agentId,
        foundingDate: new Date().toISOString(),
        member: [admin].concat(producers).map(role =>
          setId(
            Object.assign(
              {
                startDate: new Date().toISOString()
              },
              role
            ),
            createId('role', role)
          )
        )
      }
    )
  );

  const messages = validateStylesAndAssets(organization);
  if (messages.length) {
    throw createError(400, messages.join(' ; '));
  }

  action = Object.assign(
    { startTime: new Date().toISOString() },
    action,
    {
      actionStatus: 'CompletedActionStatus',
      endTime: new Date().toISOString(),
      result: getId(organization)
    },
    createId('action', null, getId(organization)) // we scope it to the org namespace so it gets deleted if we delete the org
  );

  const lock = await this.createLock(getId(organization), {
    prefix: 'create-org',
    isLocked: async () => {
      const hasUniqId = await this.hasUniqId(getId(organization));

      let prevOrg;
      try {
        prevOrg = await this.get(getId(organization), { store });
      } catch (err) {
        if (err.code !== 404) {
          throw err;
        }
      }

      return hasUniqId || !!prevOrg;
    }
  });

  let savedAction, savedOrganization;
  try {
    [savedAction, savedOrganization] = await this.put([action, organization], {
      force: true,
      store
    });
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

  return Object.assign(savedAction, {
    result: savedOrganization
  });
}
