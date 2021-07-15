// deps
const consola = require('consola');

// node
const fs = require('fs');
const path = require('path');

// globals

const JESSE_LOCALS_FIELD_BEGIN_TOKEN = '[';
const JESSE_LOCALS_FIELD_END_TOKEN = ']';
const JESSE_LOOP_DATA_TOKEN = '-';

// one-liners aka lambdas

const debugLog = (...msg) => consola.debug(...msg);
const remTopChar = str => str.substring(1, str.length);
const concatObjects = (target, src) => Object.assign(target, src);

// functions

function accessProperty(obj, key, start = 0) {
  if (!key && typeof key !== 'string') {
    throw Error('Undefined key, key must be of type string');
  }

  let i = start;
  const list = key.split('.');
  const value = obj[list[i]];

  if (!value) throw Error(`Data key "${list[i]}" is undefined`);

  if (list.length < 7) {
    if (i < list.length - 1) {
      return accessProperty(value, key, ++i);
    } else {
      return value;
    }
  } else {
    throw Error('This property is 7 levels deep. Flatten your data for better access.');
  }
}

function getValidData(data) {
  const isObj = o => o && typeof o === 'object' && o.constructor === Object;
  const isValid = Array.isArray(data) || isObj(data);

  if (!isValid) {
    throw TypeError('Data must be of type Object or Array');
  }

  return data;
}

function outputName(outName) {
  const isDir = outName.endsWith('/');
  return {
    name: !isDir ? outName : outName.substring(0, outName.length - 1),
    isDir
  };
}

function getDirPaths(srcPath, dir = '') {
  const dirents = fs.readdirSync(srcPath, {
    withFileTypes: true
  });

  return dirents.flatMap(dirent => {
    if (dirent.isDirectory()) {
      return getDirPaths(path.join(srcPath, dirent.name), dirent.name);
    }
    return path.join(path.parse(dir).base, dirent.name);
  });
}

/**
 * Validates and parses a path
 * @param {string|string[]} p The path to parse.
 * May also be a list of paths. The paths will be joined and used as one pathString
 * @param {boolean} withStas Indicates whether or not to verify if the path exists
 */
function vpath(p, withStas = false) {
  try {
    let stats = null;
    const pathString = Array.isArray(p) ? path.join(...p) : p;

    if (withStas) stats = fs.statSync(pathString);

    return {
      ...path.parse(pathString),
      stats,
      full: pathString,
      concat: (...paths) => path.join(pathString, ...paths)
    };
  } catch (error) {
    throw error;
  }
}

function handleErrors(err, { cwd }) {
  consola.error(err);

  if (err.message.startsWith('ENOENT')) {
    consola.info('Confirm the file or directory exists in the project root', `'${cwd}'`);
  }

  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

function writeFile(file, data) {
  const safeFile = vpath(file);

  const done = () => fs.writeFile(safeFile.full, data, {
    encoding: 'utf-8',
    flag: 'w'
  }, err => {
    if (err) throw err;
    debugLog('generated', safeFile.full);
  });

  try {
    const stats = fs.statSync(safeFile.dir);
    if (!stats.isDirectory()) {
      throw Error('Public output must be a directory');
    } else {
      done();
    }
  } catch (error) {
    fs.mkdir(safeFile.dir, { recursive: true }, err => {
      if (err) throw err;
      done();
    });
  }
}

function parseDynamicName(nm) {
  const localBeginIndex = nm.indexOf(JESSE_LOCALS_FIELD_BEGIN_TOKEN);
  const localEndIndex = nm.indexOf(JESSE_LOCALS_FIELD_END_TOKEN);

  if (localBeginIndex !== -1 && localEndIndex !== -1) {
    const prefix = nm.substring(0, localBeginIndex);
    const suffix = nm.substring(localEndIndex + 1, nm.length);
    let localKey = String(nm).substring(localBeginIndex + 1, localEndIndex);

    // the local key may be formated as [data item key, data item index]
    localKey = localKey.split('.');

    return {
      localIndex: Number(localKey[1]) || 0,
      localKey: localKey[0],
      place(str) {
        return prefix.concat(str, suffix);
      }
    };
  }

  return nm;
}

module.exports = {
  accessProperty,
  concatObjects,
  getValidData,
  outputName,
  getDirPaths,
  remTopChar,
  vpath,
  writeFile,
  handleErrors,
  debugLog,
  parseDynamicName,
  JESSE_LOOP_DATA_TOKEN
};
