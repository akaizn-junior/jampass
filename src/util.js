import findCacheDir from 'find-cache-dir';
import debug from 'debug';
import consola from 'consola';
import del from 'del';
import { minify } from 'minify';
import dotenv from 'dotenv';

// node
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// local
import defaultconfig from './default.config.js';

// tokens
const LOCALS_FIELD_BEGIN_TOKEN = '[';
const LOCALS_FIELD_END_TOKEN = ']';
const LOCALS_PATH_TOKEN = '_';
const LOCALS_INDEX_TOKEN = ':';
const LOCALS_LOOP_TOKEN = '-';

// quick setup
export const cachedir = findCacheDir({ name: defaultconfig.name });
export const tmpdir = (() => {
  const dir = path.join(os.tmpdir(), defaultconfig.name);

  try {
    fs.statSync(dir);
  } catch (err) {
    // create if dir does not exist
    fs.mkdirSync(dir);
  }

  return dir;
})();

// bind debug log to consola info
debug.log = consola.info.bind(consola);
export const log = debug(defaultconfig.name);

export function toggleDebug(toggle) {
  if (toggle) debug.enable(defaultconfig.name);
  else debug.disable();
}

// eslint-disable-next-line no-extra-parens
export const safeFun = cb => (cb !== void 0 && typeof cb === 'function' ? cb : () => {});

export const loadUserEnv = () => dotenv.config({
  path: path.join(process.cwd(), '.env')
});

/**
 * minify code
 * @param {object} config config
 * @param {string} file file to read
 * @param {object} opts options for minification
 * @see [minify](https://www.npmjs.com/package/minify)
 */
export function compress(config, file, lang, opts) {
  const _opts = Object.assign({
    [lang]: opts
  }, {
    [lang]: {}
  });

  try {
    return minify(file, _opts);
  } catch (err) {
    throw err;
  }
}

/**
 * create a content hash of a specific length
 * @param {string} content the data to hash
 * @param {number} len the desired length of the hash
 */
export function makeHash(content, len = null) {
  let hash = crypto
    .createHash('md5')
    .update(content)
    .digest('hex');

  len && (hash = hash.substring(0, len));
  return hash;
}

export function handleThrown(config) {
  return err => {
    const code = err.name || err.code || '';
    consola.error(code);
    consola.log(err);

    const end = () => {
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    };

    log('error object keys', Object.keys(err));

    // special cases
    const special = [
      'CssSyntaxError',
      'HtmlValidatorError'
    ];

    if (!(special.includes(code) && config.watch)) {
      // clean output folder
      const outputPath = vpath([config.cwd, config.output.path]).full;
      del(outputPath)
        .then(cleaned => {
          log('cleaned because of error: ', cleaned);
        })
        .catch(err => {
          throw err;
        });

      end();
    }
  };
}

/**
 * Validates and parses a path
 * @param {string|string[]} p The path to parse.
 * May also be a list of paths. The paths will be joined and used as one pathString
 * @param {boolean} withStats Indicates whether or not to verify if the path exists
 */
export function vpath(p, withStats = false) {
  try {
    let stats = null;
    const str = Array.isArray(p) ? path.join(...p) : p;
    if (withStats) stats = fs.statSync(str);
    const parsed = path.parse(str);

    return {
      ...parsed,
      stats,
      full: str,
      noext: str.split(parsed.ext)[0],
      join: (...paths) => vpath([str, ...paths], withStats)
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Reads a directory for a list of paths
 * @param {string} srcPath The source path to check files on
 * @param {string} dirType How to list files, full directories or subdir only
 * @param {string} dir Private recursive dir to build directory filenames
 */
export function getDirPaths(srcPath, dirType = 'sub', dir = '') {
  try {
    const ignore = [
      'node_modules'
    ];

    const dirents = fs.readdirSync(srcPath, {
      withFileTypes: true
    })
      .filter(d => !ignore.includes(d.name))
      .filter(d => !d.name.startsWith('.'));

    return dirents.flatMap(dirent => {
      if (dirent.isDirectory()) {
        return getDirPaths(path.join(srcPath, dirent.name), dirType, path.join(dir, dirent.name));
      }
      return dirType === 'full' ? path.join(srcPath, dirent.name)
        : path.join(path.parse(dir).dir, path.parse(dir).base, dirent.name);
    });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function accessProperty(obj, key, start = 0) {
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

export function parseDynamicName(fnm) {
  log('parsing dynamic name');
  const localBeginIndex = fnm.indexOf(LOCALS_FIELD_BEGIN_TOKEN);
  const localEndIndex = fnm.indexOf(LOCALS_FIELD_END_TOKEN);
  const isDynamicName = localBeginIndex !== -1 && localEndIndex !== -1;

  log('dynamic filename', fnm);

  // fail if no dyanmic name found
  // but has loop token
  if (!isDynamicName && fnm.startsWith(LOCALS_LOOP_TOKEN)) {
    throw Error('Please provide a dynamic name to loop');
  }

  if (isDynamicName) {
    const prefix = fnm.substring(0, localBeginIndex);
    const suffix = fnm.substring(localEndIndex + 1, fnm.length);
    const localKeys = String(fnm).substring(localBeginIndex + 1, localEndIndex);

    // separate local keys per paths
    const localKeysAsPath = localKeys.split(LOCALS_PATH_TOKEN);

    // find indexes from keys
    const keys = localKeysAsPath.map(localkey => {
      const lk = localkey.split(LOCALS_INDEX_TOKEN);
      const key = lk[0];
      const index = lk[1];

      return {
        key,
        index
      };
    });

    log('dynamic keys', keys);

    // remove any loop token in front of the prefix
    const cleanPrefix = prefix.startsWith(LOCALS_LOOP_TOKEN)
      ? prefix.substring(1, prefix.length)
      : prefix;

    return {
      keys,
      loop: fnm.startsWith(LOCALS_LOOP_TOKEN),
      name: fnm,
      prefix: cleanPrefix,
      suffix,
      place: str => {
        if (str.endsWith(path.sep) && suffix.startsWith('.')) {
          return cleanPrefix.concat(str, 'index', suffix);
        }

        return cleanPrefix.concat(str, suffix);
      }
    };
  }

  return {
    name: fnm
  };
}

export function pathDistance(src, target) {
  const TRAIL = '..'.concat(path.sep);

  const separate = (a, b) => {
    let sPath = '';
    let tPath = '';
    let root = '';
    const s = a.split(path.sep);
    const t = b.split(path.sep);
    const len = s.length > t.length ? s.length : t.length;

    let j = 0;
    while (j < len) {
      const sPart = s[j];
      const tPart = t[j];

      if (sPart !== tPart && tPart) {
        tPath = tPath.concat(tPath.length ? path.sep : '', tPart);
      }

      if (sPart !== tPart && sPart) {
        sPath = sPath.concat(sPath.length ? path.sep : '', sPart);
      }

      if (sPart && tPart && sPart === tPart) {
        root = root.concat(sPart, path.sep);
      }

      j++;
    }

    return { root, sPath, tPath };
  };

  const { root, sPath, tPath } = separate(src, target);

  if (!root) {
    throw Error('Paths do not exist in the same root directory');
  }

  // ignore filenames from the src path
  const sPathDir = vpath(sPath).dir;
  const tPathDir = vpath(tPath).dir;
  // get the length of the path split by 'path.sep'
  // the diff between src path and root path without src filename
  const diff = sPathDir ? sPathDir.split(path.sep).length : 0;
  const tDiff = tPathDir ? tPathDir.split(path.sep).length : 0;
  let trail = '';

  for (let i = 0; i < diff; i++) {
    trail = trail.concat(TRAIL);
  }

  const distance = {
    root,
    src: sPath,
    target: tPath,
    trail,
    srcDiff: diff,
    targetDiff: tDiff,
    distance: trail.concat(tPath)
  };

  return distance;
}
