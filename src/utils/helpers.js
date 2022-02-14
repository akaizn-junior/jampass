import { minify } from 'minify';
import * as marky from 'marky';
import { bold } from 'colorette';

// node
import crypto from 'crypto';

// local

import { asyncRead } from './stream.js';
import * as keep from './keep.js';

export const isDef = val => val !== null && val !== void 0;

export const isObj = o => isDef(o) && typeof o === 'object' && o.constructor === Object;
export const safeFun = cb => isDef(cb) && typeof cb === 'function' ? cb : () => {};

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

export function arrayAt(list, index, up = Infinity, low = 0) {
  if (index < low) return list[low];
  if (index > up && up < list.length) return list[up];
  if (index >= list.length) return list[list.length - 1];
  return list[index];
}

export function inRange(no, up = Infinity, low = 0) {
  const _no = Number(no); // no must be a number
  if (_no < low) return low;
  if (_no > up) return up;
  return _no;
}

export const formatPageEntry = no => {
  if (no === 1) return '/';
  if (no > 1) return `/${no}`;
};

export function getLoopedPageEntryClosure(config) {
  const { pagination } = config.funneled;

  const every = pagination.every;
  const paginate = every && typeof every === 'number';

  let pageNo = 1;
  let entry = '';

  /**
   * generates a page number string based on an index given by
   * checking it against the chunks the make the pagination
   * @param {number} i an item index in a overall dataset
   */
  return i => {
    if (paginate && i > 0 && i % every === 0) {
      const no = ++pageNo;
      entry = formatPageEntry(no);
    }

    return entry;
  };
}
