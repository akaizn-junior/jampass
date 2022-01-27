const { sub } = require('./sub');

function add(a, b) {
  return a + b;
}

const res = sub(add(3, 5), 99);

console.log(res);
