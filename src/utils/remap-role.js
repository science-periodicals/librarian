import pick from 'lodash/pick';
import { isRole } from '../validators';
import { COPIED_ROLE_PROPS } from '../constants';
import { getAgentId } from '../utils/schema-utils';

/**
 * Make sure that a role is remap to the desired `roleProp`
 */
export default function remapRole(
  role,
  roleProp,
  { dates = true, sameAs = false } = {}
) {
  if (isRole(role)) {
    const agentId = getAgentId(role);
    let overwrite;
    if (agentId && agentId.startsWith('user:')) {
      overwrite = { [roleProp]: agentId };
    }

    const extra = [];
    if (dates) {
      extra.push('startDate', 'endDate');
    }
    if (sameAs) {
      extra.push('sameAs');
    }

    return Object.assign(
      pick(role, COPIED_ROLE_PROPS.concat(extra)),
      overwrite
    );
  }

  return role;
}
