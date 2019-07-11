import createError from '@scipe/create-error';

/**
 * request is either request or xhr depending if client side or server side
 */
export default function(request) {
  return function(params, callback) {
    if (callback) {
      return request(params, (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return callback(err);
        }
        callback(null, resp, body);
      });
    } else {
      let r;
      const p = new Promise(function(resolve, reject) {
        r = request(params, (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            reject(err);
          }
          resolve(resp); // resp has resp.body
        });
      });
      Object.defineProperty(p, 'xhr', {
        get: function() {
          return r;
        }
      });
      p.abort = () => {
        r && r.abort && r.abort();
      };
      return p;
    }
  };
}
