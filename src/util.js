// deps
const consola = require('consola');
const cacache = require('cacache');
const findCacheDir = require('find-cache-dir');

// node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// globals

const JESSE_LOCALS_FIELD_BEGIN_TOKEN = '[';
const JESSE_LOCALS_FIELD_END_TOKEN = ']';
const JESSE_LOOP_DATA_TOKEN = '-';
const JESSE_BUILD_MODE_LAZY = 'lazy';
const JESSE_BUILD_MODE_BUSY = 'busy';
const JESSE_BUILD_MODE_STRICT = 'strict';

// quick setup

const cachePath = findCacheDir({ name: 'jesse' });

const CACHE = {
  get: k => cacache.get(cachePath, k),
  set: (k, v) => cacache.put(cachePath, k, v)
};

// lambdas

const debugLog = (...msg) => consola.debug(...msg);
const remTopChar = str => str.substring(1, str.length);
const isObj = o => o && typeof o === 'object' && o.constructor === Object;
const concatObjects = (target, src) => Object.assign(target, src);
const concatLists = (a, b, key) => {
  if (b && b[key] && Array.isArray(b[key])) {
    return a[key].concat(b[key]);
  }
  return a[key];
};

const genBuildId = () => String(Date.now());
const loadUserEnv = () => require('dotenv').config({
  path: path.join(process.cwd(), '.env')
});

// eslint-disable-next-line no-extra-parens
const safeFun = cb => (cb !== void 0 && typeof cb === 'function' ? cb : () => {});

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
  const isValid = Array.isArray(data) || isObj(data);

  if (!isValid) {
    throw TypeError('Funneled data must be of type Object or Array');
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

function getDirPaths(srcPath, dirType = 'sub', dir = '') {
  const dirents = fs.readdirSync(srcPath, {
    withFileTypes: true
  });

  return dirents.flatMap(dirent => {
    if (dirent.isDirectory()) {
      return getDirPaths(path.join(srcPath, dirent.name), dirType, path.join(dir, dirent.name));
    }
    return dirType === 'full' ? path.join(srcPath, dirent.name)
      : path.join(path.parse(dir).dir, path.parse(dir).base, dirent.name);
  });
}

/**
 * Validates and parses a path
 * @param {string|string[]} p The path to parse.
 * May also be a list of paths. The paths will be joined and used as one pathString
 * @param {boolean} withStats Indicates whether or not to verify if the path exists
 */
function vpath(p, withStats = false) {
  try {
    let stats = null;
    const pathString = Array.isArray(p) ? path.join(...p) : p;

    if (withStats) stats = fs.statSync(pathString);

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

function writeFile(file, data, dry = false) {
  const safeFile = vpath(file);

  const done = () => {
    if (!dry) {
      fs.writeFile(safeFile.full, data, {
        encoding: 'utf-8',
        flag: 'w'
      }, err => {
        if (err) throw err;
        debugLog('generated', safeFile.full);
      });
    }
  };

  try {
    const stats = fs.statSync(safeFile.dir);
    if (!stats.isDirectory()) {
      throw Error('Public output must be a directory');
    } else {
      done();
    }
  } catch (error) {
    if (!dry) {
      fs.mkdir(safeFile.dir, { recursive: true }, err => {
        if (err) throw err;
        done();
      });
    }
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


function handleCheersValidate(res, data) {
  if (!res.isValid) {
    consola.info('cheers.validate()', `"${data.gen}"`, `\ngenerated from "${data.view}"\n`);
  }

  res.errors.forEach(err => {
    consola.log(`${err.line}:${err.column}`, `"${err.ruleId}"`, 'error', err.message);
  });

  res.warnings.forEach(warn => {
    consola.log(`${warn.line}:${warn.column}`, `"${warn.ruleId}"`, 'error', warn.message);
  });

  if (!res.isValid) throw Error('HTML validation');
  return res.isValid;
}

function getHash(content, len) {
  let hash = crypto
    .createHash('md5')
    .update(content)
    .digest('hex');

  len && (hash = hash.substr(0, len));
  return hash;
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
  concatLists,
  genBuildId,
  getHash,
  loadUserEnv,
  handleCheersValidate,
  CACHE,
  safeFun,
  JESSE_LOOP_DATA_TOKEN,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
};
