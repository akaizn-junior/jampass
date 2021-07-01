const path = require('path');

function accessProperty(obj, key, start = 0) {
  if (!key && typeof key !== 'string') {
    throw Error('Undefined key, key must be of type string');
  }

  let i = start;
  const list = key.split('.');
  const value = obj[list[i]];

  if (!value) throw Error(`Data key "${list[i]}" is undefined`);

  if (list.length < 5) {
    if (i < list.length - 1) {
      return accessProperty(value, key, ++i);
    } else {
      return value;
    }
  } else {
    throw Error('This property is 5 levels of deep. Flatten your data for better access.');
  }
}

function concatObjects(target, src) {
  return Object.assign(target, src);
}

function getDataArray(arr, current) {
  if (!Array.isArray(arr)) throw TypeError('Data must be an array');
  return !current.length && Array.isArray(arr) ? arr : current;
}

function safeFilePath(file) {
  const parsedPath = path.parse(file);
  return path.join(parsedPath.dir, parsedPath.base);
}

module.exports = {
  accessProperty,
  concatObjects,
  getDataArray,
  safeFilePath
};
