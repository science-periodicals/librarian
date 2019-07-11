/**
 * This is used to handle 429 in Cloudant
 * `request` is a request instance (see https://github.com/request/request)
 *
 * Note: we also retry on 500 because of https://stackoverflow.com/questions/46051841/internal-error-about-compactor-in-cloudant-local-docker (seems to happen only on CI)
 */
export default function createCouchClient(request, config = {}) {
  function couch(params = {}, callback, _n429, _n500) {
    if (!callback) return request(params); // stream support TODO handle 429 there too

    if (typeof params === 'string') {
      params = { url: params };
    }

    const max500Retry = params.max500retry || config.max500retry || 5;

    _n429 =
      _n429 == null ? params.max429retry || config.max429retry || 10 : _n429;
    _n500 = _n500 == null ? max500Retry : _n500;

    let r = request(params, (err, resp, body) => {
      if (err) return callback(err, resp, body);
      if (resp.statusCode === 429 && _n429 > 0) {
        const delay = params.delay429Retryy || config.delay429Retry || 1000;
        setTimeout(() => {
          r = couch(params, callback, --_n429, _n500);
        }, Math.max(delay - 200, 0) + Math.floor(Math.random() * 200));
      } else if (resp.statusCode === 500 && _n500 > 0) {
        const retryCount = max500Retry - _n500;
        setTimeout(() => {
          r = couch(params, callback, _n429, --_n500);
        }, 50 * Math.pow(2, retryCount)); // exp backoff
      } else {
        callback(err, resp, body);
      }
    });
    return r;
  }

  couch.head = function(params, callback) {
    return couch(Object.assign({ method: 'HEAD' }, params), callback);
  };
  couch.get = function(params, callback) {
    return couch(Object.assign({ method: 'GET' }, params), callback);
  };
  couch.put = function(params, callback) {
    return couch(Object.assign({ method: 'PUT' }, params), callback);
  };
  couch.post = function(params, callback) {
    return couch(Object.assign({ method: 'POST' }, params), callback);
  };
  couch.patch = function(params, callback) {
    return couch(Object.assign({ method: 'PATCH' }, params), callback);
  };
  couch.del = function(params, callback) {
    return couch(Object.assign({ method: 'DELETE' }, params), callback);
  };
  couch.options = function(params, callback) {
    return couch(Object.assign({ method: 'OPTIONS' }, params), callback);
  };

  return couch;
}
