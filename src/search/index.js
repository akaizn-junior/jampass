/* globals fetch */

const TrieSearch = require('trie-search');
const trie = new TrieSearch();

async function init() {
  const res = await fetch('/indexes.json');
  const data = await res.json();
  trie.addFromObject(data);
}

init();

/**
 * render search
 * @param {HTMLElement} inputEl the search input
 * @param {HTMLElement} resEl element to attach results to
 */
function render(inputEl, resEl) {
  inputEl.addEventListener('keyup', e => {
    e.preventDefault();
    const term = e.target.value;
    const results = trie.search(term);

    resEl.innerHTML = results.map(result => {
      const index = result.value.index;
      const value = result.value.value;
      const found = value[index];

      return `<p>${found}</p>`;
    }).join('');
  }, false);
}

module.exports = {
  trie,
  render
};
