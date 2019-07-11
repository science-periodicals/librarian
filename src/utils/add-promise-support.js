// Note `this` can be a librarian instance if this is used to add a method to Librarian.prototype
export default function addPromiseSupport(f) {
  return function(...args) {
    if (typeof args[args.length - 1] === 'function') {
      return f.apply(this, args);
    }

    return new Promise((resolve, reject) => {
      f.call(this, ...args, (err, value) => {
        if (err) return reject(err);
        resolve(value);
      });
    });
  };
}
