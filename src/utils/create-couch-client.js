/**
 * This is used to handle 429 in Cloudant (cloudant is throttled and we need
 * to manually retry on 429)
 *
 * Note: we also retry on:
 * - network error (`err`) with no responses (Cloudant often triggers `ECONNRESET`)
 * - 500 because of https://stackoverflow.com/questions/46051841/internal-error-about-compactor-in-cloudant-local-docker (seems to happen only on CI)
 */
export default function createCouchClient(
  request, // a `request` instance (see https://github.com/request/request)
  config = {},
  logger // optional bunyan instance (can be undefined)
) {
  function couch(params = {}, callback, _n429, _n500, _nErr) {
    if (!callback) {
      return request(params); // stream support TODO handle 429 there too
    }

    if (typeof params === 'string') {
      params = { url: params };
    }

    const maxErrRetry = params.maxErrRetry || config.maxErrRetry || 5;
    const max500Retry = params.max500Retry || config.max500Retry || 5;
    const max429Retry = params.max429Retry || config.max429Retry || 10;

    _nErr = _nErr == null ? maxErrRetry : _nErr;
    _n500 = _n500 == null ? max500Retry : _n500;
    _n429 = _n429 == null ? max429Retry : _n429;

    let r = request(params, (err, resp, body) => {
      if (err) {
        if (_nErr > 0) {
          const retryCount = maxErrRetry - _nErr;
          if (logger && logger.warn) {
            logger.warn(
              { err, retryCount, maxErrRetry, params },
              'CouchClient err'
            );
          }
          setTimeout(() => {
            r = couch(params, callback, _n429, _n500, --_nErr);
          }, 50 * Math.pow(2, retryCount)); // exp backoff
        } else {
          callback(err, resp, body);
        }
      } else {
        if (resp.statusCode === 429 && _n429 > 0) {
          const retryCount = maxErrRetry - _nErr;
          if (logger && logger.debug) {
            logger.debug(
              { err, retryCount, max429Retry, params },
              'CouchClient 429'
            );
          }
          const delay = params.delay429Retryy || config.delay429Retry || 1000;
          setTimeout(() => {
            r = couch(params, callback, --_n429, _n500, _nErr);
          }, Math.max(delay - 200, 0) + Math.floor(Math.random() * 200));
        } else if (resp.statusCode === 500 && _n500 > 0) {
          const retryCount = max500Retry - _n500;
          if (logger && logger.warn) {
            logger.warn(
              { err, retryCount, max500Retry, params },
              'CouchClient 500'
            );
          }
          setTimeout(() => {
            r = couch(params, callback, _n429, --_n500, _nErr);
          }, 50 * Math.pow(2, retryCount)); // exp backoff
        } else {
          callback(err, resp, body);
        }
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
