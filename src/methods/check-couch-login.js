import { reUuid } from '@scipe/jsonld';
import createError from '@scipe/create-error';

export default function checkCouchLogin(callback) {
  this.session((err, session) => {
    if (err) return callback(err);
    // !! calling session without authHeaders on cloudant local at least result in a 200 with ok but userCtx.name is null but this is fine as we catch that in this.session
    if (session && session.userCtx && session.userCtx.name === null) {
      const msg =
        process.env.NODE_ENV === 'production'
          ? 'We are encountering an issue please try to logout and login again. If the issue persists please contact support@sci.pe.'
          : 'Cloudant session bug (session is OK but userCtx.name is null). Try to logout and login again and if the issue persists, restart cloudant local to fix (docker restart cloudant-developer)';
      return callback(createError(401, msg));
    }

    let username;
    const _username = session.userCtx && session.userCtx.name;
    const [maybeUsername, maybeToken] = _username.split('~'); // we need to take into account proxy users
    if (maybeToken && reUuid.test(maybeToken)) {
      username = maybeUsername;
    } else {
      username = _username;
    }

    return callback(null, !!(username && username === this.username), session);
  });
}
