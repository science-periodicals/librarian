import { getId } from '@scipe/jsonld';

export function createLatestPublicationIssueLockId(periodicalId) {
  return `latest:${getId(periodicalId)}`;
}
