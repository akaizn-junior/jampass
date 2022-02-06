/* globals fetch */

const TrieSearch = require('trie-search');
const trie = new TrieSearch();

async function init() {
  const res = await fetch('/indexes.json');
  const data = await res.json();
  trie.addFromObject(data);
}

init();

module.exports = {
  trie
};
