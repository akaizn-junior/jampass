/* globals fetch */

const TrieSearch = require('trie-search');

/**
 * inits a TrieSearch with indexes data
 * @param {string} file indexes file name
 */
async function init(file = '/indexes.json') {
  const res = await fetch(file || '/indexes.json');
  const data = await res.json();
  const trie = new TrieSearch();
  trie.addFromObject(data);
  return trie;
}

async function query(term, cb = () => {}) {
  const _cb = cb && typeof cb === 'function'
    ? cb : () => {};
  const trie = await init();
  const results = trie.search(term);
  _cb(results);
  return results;
}

module.exports = {
  init,
  query,
  TrieSearch
};
