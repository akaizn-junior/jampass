const srch = document.getElementById('search');
// const panel = document.getElementById('search-results');

function queryFn(term) {
  console.log(term);
}

function handleUrlSearch() {
  const query = new URLSearchParams(location.search);

  if (query.has('s')) {
    const term = query.get('s');
    srch.setAttribute('value', term);
    queryFn(term);
  }
}

handleUrlSearch();

srch.addEventListener('keyup', e => {
  const term = e.target.value;
  queryFn(term);
}, false);

srch.addEventListener('search', () => {
  queryFn('');
}, false);
