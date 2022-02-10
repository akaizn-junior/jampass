/* globals fetch */

const TrieSearch = require('trie-search');
const root = new TrieSearch();

async function init() {
  const res = await fetch('/indexes.json');
  const data = await res.json();
  root.addFromObject(data);
}

init();

function _paint(result) {
  return `<p>${result.value[result.index]}</p>`;
}

/**
 * render search
 * @param {HTMLElement} inputEl the search input
 * @param {HTMLElement} resEl element to attach results to
 * @param {function|null} paint a callback for search results
 */
function render(inputEl, resEl, paint = null, trie = root) {
  const p = paint && typeof paint === 'function'
    ? paint : _paint;

  inputEl.addEventListener('keyup', e => {
    e.preventDefault();
    const term = e.target.value;
    const results = trie.search(term);

    resEl.innerHTML = results.map(result => {
      const res = result.value;
      return p(res);
    }).join('');
  }, false);
}

module.exports = {
  trie: root,
  render,
  TrieSearch
};
