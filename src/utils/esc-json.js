export default function escJSON(obj) {
  const str = JSON.stringify(obj);
  if (str) {
    //- \u2028: line separator
    //- \u2029: paragraph separator
    // those 2 characters are valid JSON _but_ for JavaScript, these two characters are considered to be the same as \n.
    // => it breaks window.__INITIAL_STATE__ = <%- locals.escJSON(locals.initialState) %> as the JS parser will complain...
    // to prevent that we escape them...

    return str
      .replace(/<\/script/gi, '<\\u002fscript')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }
  return str;
}
