import findCacheDir from 'find-cache-dir';
import debug from 'debug';
import consola from 'consola';
import del from 'del';
import { minify } from 'minify';
import dotenv from 'dotenv';
import * as marky from 'marky';
import { bold, bgBlack, red } from 'colorette';

// node
import fs from 'fs';
import path from 'path';
import os, { EOL } from 'os';
import crypto from 'crypto';

// local
import defaultconfig from './default.config.js';

// tokens
const LOCALS_FIELD_BEGIN_TOKEN = '[';
const LOCALS_FIELD_END_TOKEN = ']';
const LOCALS_PATH_TOKEN = '_';
const LOCALS_INDEX_TOKEN = ':';
const LOCALS_LOOP_TOKEN = '-';
const MAX_RECURSIVE_ACESS = 7;

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

// consola instance
export const logger = consola.create({
  level: 4,
  throttle: 3,
  async: true,
  reporters: [
    new consola.FancyReporter()
  ]
});

// bind debug log to consola info
debug.log = logger.log.bind(logger);
export const debuglog = debug(defaultconfig.name);

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
export function createHash(content, len = null) {
  let hash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  len && (hash = hash.substring(0, len));
  return hash;
}

export function handleThrown(config) {
  return err => {
    const end = () => {
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    };

    debuglog('error object keys', Object.keys(err));

    // special cases
    const special = [
      'CssSyntaxError',
      'HtmlValidatorError'
    ];

    const errname = err.name || err.code || '';

    if (!special.includes(errname)) {
      logger.error(errname);
      logger.log(err);
    }

    if (!config.watch) {
      // clean output folder
      const outputPath = vpath([config.cwd, config.output.path]).full;
      del(outputPath)
        .then(cleaned => {
          debuglog('error! cleaned output', cleaned);
        });
      end();
    }
  };
}

/**
 * Validates and parses a path
 * @param {string|string[]} p The path to parse or a list of paths
 * @param {boolean} withStats Get path stats
 */
export function vpath(p, withStats = false) {
  try {
    let stats = null;
    const str = Array.isArray(p) ? path.join(...p) : p;
    if (withStats) stats = fs.statSync(str); // for now this stays a sync op
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

  const list = key.split('.');
  let i = start;
  const j = list[i];
  const value = obj[j];

  if (!value) throw Error(`Data key "${j}" is undefined`);

  if (list.length < MAX_RECURSIVE_ACESS) {
    if (i < list.length - 1) {
      return accessProperty(value, key, ++i);
    } else {
      return value;
    }
  } else {
    throw Error(`Reached max recursive acess ${MAX_RECURSIVE_ACESS}`);
  }
}

export function parseDynamicName(fnm) {
  debuglog('parsing dynamic name');
  const dynBeginIndex = fnm.indexOf(LOCALS_FIELD_BEGIN_TOKEN);
  const dynEndIndex = fnm.indexOf(LOCALS_FIELD_END_TOKEN);
  const isDynamicName = dynBeginIndex !== -1 && dynEndIndex !== -1;

  debuglog('dynamic filename', fnm);

  if (isDynamicName) {
    const hasLoopToken = fnm.startsWith(LOCALS_LOOP_TOKEN);
    const prefix = fnm.substring(0, dynBeginIndex);
    const suffix = fnm.substring(dynEndIndex + 1, fnm.length);
    const localKeys = String(fnm).substring(dynBeginIndex + 1, dynEndIndex);

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

    debuglog('dynamic keys', keys);

    // if is valid remove the loop token here
    const cleanPrefix = hasLoopToken
      ? prefix.substring(1, prefix.length)
      : prefix;

    return {
      keys,
      loop: hasLoopToken,
      name: fnm,
      prefix: cleanPrefix,
      suffix,
      place: str => {
        if (str.endsWith(path.sep) && suffix.startsWith('.')) {
          return cleanPrefix.concat(str, 'index.html');
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

/**
 * format error name
 * @param {string} name Error name
 * @param {string} prefix Prefix the error name
 * @param {string[]} exclude Exclude specific errors
 * @returns string
 */
export function fErrName(name, prefix, exclude = []) {
  if (exclude.includes(name)) {
    return name;
  }

  return prefix.concat(name);
}

export function markyStop(name, { label, count }) {
  const timer = marky.stop(name);
  const end = Math.floor(timer.duration) / 1000;
  logger.success(`"${label}" -`, count, `- ${end}s`);
}

export function splitPathCwd(cwd, s) {
  if (s.startsWith(cwd)) {
    const p = s.split(cwd + path.sep)[1];
    return p;
  }
  return s;
}

export function spliceCodeSnippet(code, lnumber, column = 0, opts = {}) {
  const multiLineString = code;
  const lines = multiLineString.split(EOL);
  opts = Object.assign({
    range: 5,
    startIndex: 0
  }, opts);

  const cut = (a, b, max) => {
    const lower = a < 0 ? 0 : a;
    const upper = b > max ? max : b;
    return { lower, upper };
  };

  const markLine = (s, a, b, max) => {
    const prefix = s.substring(0, a);
    const word = s.substring(a, b);
    const suffix = s.substring(b, max);
    return prefix.concat(red(word), suffix);
  };

  // get only lines withing a range
  const lrange = cut(
    lnumber - opts.range,
    lnumber + opts.range,
    lines.length
  );

  let maxLineLen = 50;
  const slice = lines.map((line, i) => {
    const ln = i + 1 + opts.startIndex;
    maxLineLen = maxLineLen < line.length ? line.length : maxLineLen;

    if (ln === lnumber + opts.startIndex) {
      const c = cut(column - 1, column + 1, line.length);
      const ml = markLine(line, c.lower, c.upper, line.length);
      return bold(`${ln} ${ml}`);
    }

    return `${ln} ${line}`;
  })
    .slice(lrange.lower, lrange.upper);

  const snippet = bgBlack(slice.join(EOL)).concat(EOL);
  return snippet;
}
