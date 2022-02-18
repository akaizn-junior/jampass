/* globals Search */

const srch = document.getElementById('search');
const panel = document.getElementById('search-results');

function paint(results) {
  panel.style.display = results.length
    ? 'block' : 'none';

  panel.innerHTML = results.map(result => {
    const item = result.value;
    const text = item.value[item.index];
    const name = item.value.name;

    if (item.index !== 'name') {
      return `<div class="search-item">
        <p>${item.index}: ${text}</p>
        <a href="${name}">${name}</a>
      </div>`;
    }

    return `<div class="search-item">
        <p>${item.index}</p>
        <a href="${name}">${name}</a>
      </div>`;
  }).join('');
}

function handleUrlSearch() {
  const query = new URLSearchParams(location.search);

  if (query.has('s')) {
    const term = query.get('s');
    srch.setAttribute('value', term);
    Search.query(term, paint);
  }
}

handleUrlSearch();

srch.addEventListener('keyup', e => {
  const term = e.target.value;
  Search.query(term, paint);
}, false);

srch.addEventListener('search', () => {
  Search.query('', paint);
}, false);
