import once from 'once';

// Note `this` can be a librarian instance if this is used to add a method to Librarian.prototype
export default function addCallbackSupport(f) {
  return function(...args) {
    if (args.length && typeof args[args.length - 1] === 'function') {
      const callback = once(args[args.length - 1]);
      return f
        .apply(this, args.slice(0, args.length - 1))
        .then(payload => {
          callback(null, payload);
        })
        .catch(err => {
          callback(err);
        });
    }

    return f.apply(this, args);
  };
}
