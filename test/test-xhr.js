import http from 'http';
import assert from 'assert';
import { xhr } from '../src';

const hostname = '127.0.0.1';
const port = 3333;

describe('xhr', function() {
  let server;
  before(done => {
    server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Hello World\n');
    });
    server.listen(port, hostname, done);
  });

  it('should make an xhr using the Promise API', () => {
    const p = xhr({
      url: `http://${hostname}:${port}`
    });
    assert(p.xhr, 'a ref to original xhr object is available');
    p.then(({ body }) => {
      assert.equal(body, 'Hello World\n');
    });
    return p;
  });

  it('should make an xhr using the callback API', done => {
    xhr(
      {
        url: `http://${hostname}:${port}`
      },
      (err, resp, body) => {
        if (err) return done(err);
        assert.equal(body, 'Hello World\n');
        done();
      }
    );
  });

  after(done => {
    server.close(done);
  });
});
