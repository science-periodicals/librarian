import createError from '@scipe/create-error';

export default function getProxyUserByAuthenticationToken(
  token, // !! if a string is passed, it must be the `value` of the `AuthenticationToken` (not the @id)
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }

  const tokenValue = token.value || token;

  this.authDbView.get(
    {
      url: '/proxyUserByAuthenticationToken',
      qs: {
        key: JSON.stringify(tokenValue),
        include_docs: false,
        reduce: false
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      const id = body && body.rows && body.rows[0] && body.rows[0].id;

      if (!id) {
        return callback(createError(404, 'No proxy user'));
      }

      const splittedId = id.split('~');

      const proxyUser = {
        '@id': id.replace(/^org.couchdb.user:/, 'user:'),
        '@type': 'ProxyUser',
        username: id.replace(/^org.couchdb.user:/, ''),
        password: token,
        proxiedUserId: splittedId
          .slice(0, Math.max(splittedId.length - 1, 1))
          .join('~')
          .replace(/^org.couchdb.user:/, 'user:')
      };

      callback(null, proxyUser);
    }
  );
}
