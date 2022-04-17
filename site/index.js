window.onload = function() {
  const hash = location.hash;
  const elem = document.getElementById(`${hash}-item`);

  if (elem) {
    elem.classList.add('active-item');
  }
};

window.onhashchange = function() {
  const hash = location.hash;
  const elem = document.getElementById(`${hash}-item`);
  const active = document.querySelector('.active-item');

  if (active) {
    active.classList.remove('active-item');
  }

  if (elem) {
    elem.classList.add('active-item');
  }
};
