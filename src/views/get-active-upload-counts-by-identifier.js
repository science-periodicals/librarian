import createError from '@scipe/create-error';

export default function getActiveUploadCountsByIdentifier(
  identifier,
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  if (!opts) {
    opts = {};
  }
  const { store } = opts;

  this.view.get(
    {
      url: '/activeUploadsByIdentifier',
      qs: {
        key: JSON.stringify(identifier),
        reduce: true,
        include_docs: false
      },
      json: true
    },
    (err, resp, body) => {
      if ((err = createError(err, resp, body))) {
        return callback(err);
      }

      let counts;
      try {
        counts = body.rows[0].value;
      } catch (err) {
        counts = 0;
      }
      callback(null, counts);
    }
  );
}
