/* globals Search */

const srch = document.getElementById('search');
const resEl = document.getElementById('search-results');

function paint(res) {
  const v = res.value[res.index];
  return `<p>${v}</p>`;
}

Search.render(srch, resEl, paint);
