import omit from 'lodash/omit';
import { contextUrl, getId, arrayify } from '@scipe/jsonld';
import {
  CONTACT_POINT_ADMINISTRATION,
  CONTACT_POINT_EDITORIAL_OFFICE,
  CONTACT_POINT_GENERAL_INQUIRY
} from '../constants';
import createId from '../create-id';
import setId from '../utils/set-id';
import { getAgent } from '../utils/schema-utils';
import { setEmbeddedIds } from './embed-utils';

export default function createProfile(agent) {
  const user = getAgent(agent);

  const memberOf = arrayify(user.memberOf)
    .filter(org => getId(org, 'memberOf') !== 'org:scipe')
    .concat({
      '@type': 'OrganizationRole',
      memberOf: {
        '@id': 'org:scipe'
      },
      startDate: new Date().toISOString()
    });

  return setEmbeddedIds(
    setId(
      Object.assign(omit(user, ['password', 'email', '@id', '_id', '_rev']), {
        '@context': contextUrl,
        '@type': 'Person',
        // We set ALL possible contact points
        contactPoint: [
          CONTACT_POINT_ADMINISTRATION,
          CONTACT_POINT_EDITORIAL_OFFICE,
          CONTACT_POINT_GENERAL_INQUIRY
        ].map(contactType => {
          return {
            '@id': createId('contact', contactType, getId(user))['@id'],
            '@type': 'ContactPoint',
            contactType,
            email: user.email,
            verificationStatus: 'VerifiedVerificationStatus'
          };
        }),
        memberOf: memberOf.length === 1 ? memberOf[0] : memberOf
      }),
      createId('profile', getId(user))
    )
  );
}
