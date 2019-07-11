import { encrypt } from '../crypto/encrypt';
import { getId, unprefix } from '@scipe/jsonld';

export default function createPassword(user, secret) {
  const userId = getId(user);
  return encrypt(unprefix(userId), secret);
}
