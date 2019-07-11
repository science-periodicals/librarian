/**
 * return the http-01 challenge for `hostname` and `key` (see let's encrypt documentation)
 */
export default function getCertificate(hostname, key, callback) {
  this.challengeStore.get(hostname, key, callback);
}
