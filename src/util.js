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

module.exports = { accessProperty };
