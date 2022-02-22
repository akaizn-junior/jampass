import { minify } from 'minify';
import * as marky from 'marky';
import { bold } from 'colorette';

// node
import crypto from 'crypto';
import { EOL } from 'os';

// local

import { asyncRead } from './stream.js';
import * as keep from './keep.js';
import { DEFAULT_PAGE_NUMBER, PARTIALS_PATH_NAME, PARTIALS_TOKEN } from './constants.js';
import { vpath } from './path.js';
import { spliceCodeSnippet } from './process.js';

export const isDef = val => val !== null && val !== void 0;

export const isObj = o => isDef(o) && typeof o === 'object' && o.constructor === Object;
export const safeFun = cb => isDef(cb) && typeof cb === 'function' ? cb : () => {};

export function markyStop(name, log = null) {
  const timer = marky.stop(name);
  const end = Math.floor(timer.duration) / 1000;
  return log ? safeFun(log)(end) : end;
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
    err.name = 'MinifyHtmlError';
    throw err;
  }
}

export function reduceViewsByChecksum(config, rewatch = null) {
  return async(acc, view) => {
    const _rewatch = safeFun(rewatch);

    try {
      const exists = keep.get(view);
      const checksum = await asyncRead(view, c => createHash(c, 64));
      const newContent = checksum !== exists?.checksum;

      const viewName = vpath(view).name;
      const withPartialsToken = viewName.startsWith(PARTIALS_TOKEN);
      const isPartial = withPartialsToken || view.includes(`/${PARTIALS_PATH_NAME}/`);

      if (isPartial) {
        // register partials to funneled data
        let partial = viewName;
        if (withPartialsToken) partial = viewName.split(PARTIALS_TOKEN)[1];

        const def = config.funneled.partials[partial];
        if (!def) config.funneled.partials[partial] = view;

        keep.add(view, { checksum, isValidHtml: false });
        return acc;
      }

      const add = newContent && !isPartial;

      if (add || config.bypass) {
        // only allow views with new content
        (await acc).push({ path: view, checksum });
      }

      keep.add(view, { checksum, isValidHtml: false });
      return acc;
    } catch (err) {
      if (err.code === 'ENOENT') {
        _rewatch();
        return acc;
      }
      throw err;
    }
  };
}

export function showTime(end, lap, show = true) {
  return show
    ? `(${bold(`${end}s`)} \u00b7 ${lap}s)`
    : '';
}

/**
 * partitions a list by 'chunk' amounts of data
 * @param {[]} arr the list to partition
 * @param {number} chunk the amount in each partition
 * @returns
 */
export function partition(arr, chunk) {
  if (arr && Array.isArray(arr) && chunk && chunk >= 1) {
    const res = [];
    const parts = Math.ceil(arr.length / chunk);

    for (let i = 0; i < parts; i++) {
      // arr.slice is safe even if upper index overflows
      // but of course be fucking safe
      const upper = chunk + chunk * i;
      const safeUpper = upper > arr.length ? arr.length : upper;
      res.push(arr.slice(i * chunk, safeUpper));
    }

    return res;
  }

  return arr;
}

export function inRange(no, up = Infinity, low = 0) {
  const _no = Number(no); // no must be a number
  if (_no < low) return low;
  if (_no > up) return up;
  return _no;
}

export function arrayValueAt(list, index, low = 0) {
  return list[inRange(index, list.length - 1, low)];
}

export const formatPageEntry = no => {
  if (no === DEFAULT_PAGE_NUMBER) return '/';
  if (no > DEFAULT_PAGE_NUMBER) return `/${no}`;
};

export function getDataItemPageClosure(config) {
  const { pagination } = config.funneled;

  const every = pagination?.every;
  let pageNo = DEFAULT_PAGE_NUMBER;
  let entry = '/';

  /**
   * generates a page number string based on an index given by
   * checking it against the chunks the make the pagination
   * @param {number} i an item index in a overall dataset
   */
  return i => {
    if (config.paginate && i > 0 && i % every === 0) {
      const no = ++pageNo;
      entry = formatPageEntry(no);
    }

    return entry;
  };
}

export async function genSnippet(opts, file = '') {
  const _opts = Object.assign({
    code: null,
    line: 0,
    column: 0,
    range: 5,
    startIndex: 0,
    title: ''
  }, opts);

  const code = _opts.code || await asyncRead(file);
  const snippet = spliceCodeSnippet(code, _opts.line, _opts.column, {
    range: _opts.range,
    startIndex: _opts.startIndex
  });

  return _opts.title.concat(EOL, EOL, snippet);
}

/**
 * format a value in bytes
 * @param {number|string} bytes value in bytes
 * @param {number} base the units number base
 */
export function formatBytes(bytes, base = 10) {
  const _bytes = Number(bytes);
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const bases = { 2: 1024, 10: 1000 };
  const _1kb = bases[base] || bases[10];

  if (isNaN(_bytes)) return null;

  // item indexes of the units array wil be useed as exponents
  // find the index based on the bytes given divided by 1kb
  const index = Math.floor(Math.log(_bytes) / Math.log(_1kb));

  if (_bytes === 0) return '0B';
  if (index === 0) return _bytes + units[0];

  const exponent = Math.pow(_1kb, index);
  // format fractional number with fixed point notation
  const fixed = (_bytes / exponent).toFixed(1);
  return fixed + units[index];
}
