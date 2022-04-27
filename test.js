import util from 'util';

export const isDef = val => val !== null && val !== void 0;

export const isObj = o => isDef(o) && typeof o === 'object' && o.constructor === Object;

function objectDeepMerge(...objects) {
  return objects.reduce((acc, curr) => {
    // verify all keys
    const allKeys = Object.keys(curr);

    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      // does the current key exist already
      const accValue = acc[key];
      const value = curr[key];

      if (isObj(accValue) && isObj(value)) {
        acc[key] = objectDeepMerge(accValue, value);
      } else {
        acc[key] = value;
      }
    }

    return acc;
  }, {});
}

const a = {
  foo: {
    a: {
      s: 789
    }
  }
};

const b = {
  foo: {
    a: {
      d: 123
    },
    c: 678
  }
};

const ins = util.inspect(objectDeepMerge(a, b), true, 10);

console.log(ins);
