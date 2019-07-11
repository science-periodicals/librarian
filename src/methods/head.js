import createError from '@scipe/create-error';

export default function head(object, callback) {
  const _id = object._id || object;
  if (typeof _id !== 'string') {
    return callback(createError(500, 'Could not find a valid _id'));
  }

  this.db.head(
    {
      url: `/${encodeURIComponent(_id)}`
    },
    (err, resp) => {
      if (err) return callback(err);
      if (!resp.headers.etag) {
        return callback(createError(resp.statusCode, 'no etag'));
      }
      const rev = resp.headers.etag.replace(/^"(.*)"$/, '$1');
      callback(null, rev);
    }
  );
}
