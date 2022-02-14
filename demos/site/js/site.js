const { sub } = require('./sub');

function add(a, b) {
  return a + b;
}

sub(200, add(3, 5));
