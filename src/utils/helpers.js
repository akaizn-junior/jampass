import debug from 'debug';
import consola from 'consola';
import dotenv from 'dotenv';
import del from 'del';
import { minify } from 'minify';
import * as marky from 'marky';

// node
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// local
import defaultconfig from '../default.config.js';
import { vpath } from './path.js';
import { writeFile, asyncRead, newReadable } from './stream.js';
import * as keep from './keep.js';

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

class HomeDirReporter extends consola.BasicReporter {
  constructor(options) {
    super(options);
    this.historyFile = defaultconfig.historyFilePath;
    this.lastFile = defaultconfig.lastCmdFilePath;
  }

  log(logObj, { stdout } = {}) {
    let line = this.formatLogObj(logObj, {
      width: stdout.columns || 0
    });

    line = ''.concat(Date.now(), ';', line, '\n');
    writeFile(newReadable(line), this.historyFile, null, 'a+');
    return;
  }
}

export const logger = consola.create({
  level: 4,
  throttle: 3,
  async: true,
  reporters: [
    new consola.FancyReporter()
  ]
});

export const history = consola.create({
  async: true,
  reporters: [
    new HomeDirReporter()
  ]
});

// bind debug log to consola info
debug.log = logger.log.bind(logger);
export const debuglog = debug(defaultconfig.name);

export function toggleDebug(toggle) {
  if (toggle) debug.enable(defaultconfig.name);
  else debug.disable();
}

export const safeFun = cb => cb !== void 0 && typeof cb === 'function' ? cb : () => {};

export const loadUserEnv = () => dotenv.config({
  path: path.join(process.cwd(), '.env')
});

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
      logger.error(errname, err);
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
 * format error name
 * @param {string} name Error name
 * @param {string} prefix Prefix the error name
 * @param {string[]} exclude Exclude specific errors
 */
export function fErrName(name, prefix, exclude = []) {
  if (exclude.includes(name)) {
    return name;
  }

  return prefix.concat(name);
}

export function markyStop(name, opts = {}) {
  const { log, label, count = 1 } = opts;

  const timer = marky.stop(name);
  const end = Math.floor(timer.duration) / 1000;

  opts.label && logger.success(`"${label}" -`, count, `- ${end}s`);
  opts.log && log(end);
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

export async function minifyHtml(config, file) {
  try {
    const res = await compress(config, file, 'html', {
      minifyCSS: false,
      minifyJS: false,
      noNewlinesBeforeTagClose: true,
      removeAttributeQuotes: true
    });

    return res;
  } catch (err) {
    err.name = fErrName(err.name, 'MinifyHtml');
    throw err;
  }
}

export function reduceViewsByChecksum(rewatch = null) {
  return async(acc, view) => {
    try {
      const exists = keep.get(view);
      const checksum = await asyncRead(view, c => createHash(c, 64));

      // only allow views with new content
      if (checksum !== exists?.checksum) {
        (await acc).push({ path: view, checksum });
      }

      return acc;
    } catch (err) {
      if (err.code === 'ENOENT') {
        safeFun(rewatch)();
        return [];
      }
      throw err;
    }
  };
}
