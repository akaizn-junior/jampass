import { bold, red, dim } from 'colorette';
import browserify from 'browserify';

// postcss and plugins
import postcss from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import postCssHash from 'postcss-hash';

// node
import { EOL } from 'os';
import path from 'path';

// local
import {
  createHash,
  compress,
  inRange,
  partition,
  isObj,
  formatPageEntry,
  genSnippet
} from './helpers.js';

import {
  debuglog,
  logger,
  tmpdir
} from './init.js';

import { vpath, getSrcBase, splitPathCwd } from './path.js';
import { writeFile, newReadable, asyncRead } from './stream.js';
import * as keep from './keep.js';

import {
  FIELD_BEGIN_TOKEN,
  FIELD_END_TOKEN,
  PATH_TOKEN,
  INDEX_TOKEN,
  LOOP_TOKEN,
  PAGE_TOKEN,
  INDEX_PAGE,
  MAX_RECURSIVE_ACESS,
  DEFAULT_PAGE_NUMBER
} from './constants.js';

export function accessProperty(obj, key, start = 0) {
  if (!key && typeof key !== 'string') {
    throw Error('undefined, key must be of type string');
  }

  const list = key.split('.');
  let i = start;
  const j = list[i];
  const value = obj[j];

  if (!value) throw Error(`data key "${j}" is undefined`);

  if (list.length < MAX_RECURSIVE_ACESS) {
    if (i < list.length - 1) {
      return accessProperty(value, key, ++i);
    } else {
      return value;
    }
  } else {
    throw Error(`reached max recursive acess ${MAX_RECURSIVE_ACESS}`);
  }
}

export function parseDynamicName(fnm) {
  debuglog('parsing dynamic name');
  const dynBeginIndex = fnm.indexOf(FIELD_BEGIN_TOKEN);
  const dynEndIndex = fnm.indexOf(FIELD_END_TOKEN);
  const isDynamicName = dynBeginIndex !== -1 && dynEndIndex !== -1;

  debuglog('dynamic filename', fnm);

  if (isDynamicName) {
    const hasLoopToken = fnm.startsWith(LOOP_TOKEN);
    const prefix = fnm.substring(0, dynBeginIndex);
    const suffix = fnm.substring(dynEndIndex + 1, fnm.length);
    const localKeys = String(fnm).substring(dynBeginIndex + 1, dynEndIndex);

    // check the prefix for the page number first
    // the prefix has to be numberlike to pass as the page number
    // her page can be the dwfault valur or a Number (including isNaN of course)
    let page = isNaN(prefix) ? DEFAULT_PAGE_NUMBER : parseInt(prefix, 10);
    // if no page found in the prefix check the page token
    if ((page === DEFAULT_PAGE_NUMBER || isNaN(page)) && localKeys.startsWith(PAGE_TOKEN)) {
      // this string is just the page number
      // or a string that starts with the page number
      let maybe = localKeys.substring(1, dynEndIndex);
      // split path if path token found
      maybe = maybe.split(PATH_TOKEN)[0] ?? maybe;
      const maybeNumber = Number(maybe);

      // at this point the page is either NaN or the page number
      if (isNaN(maybeNumber)) {
        throw new Error(`page is not a number. page "${maybe}"`);
      }

      page = maybeNumber;
    }

    // separate local keys per paths
    const localKeysAsPath = localKeys.split(PATH_TOKEN);

    // find indexes from keys
    const keys = localKeysAsPath.map(localkey => {
      const lk = localkey.split(INDEX_TOKEN);
      const key = lk[0].startsWith(PAGE_TOKEN) || !lk[0]
        ? null : lk[0];
      const index = lk[1] ?? null;

      return {
        key,
        index
      };
    });

    if (hasLoopToken && keys.every(lk => lk.key === null)) {
      throw new Error('attempting to loop single page');
    }

    debuglog('dynamic keys', keys);

    // if is valid remove the loop token here
    const cleanPrefix = hasLoopToken
      ? prefix.substring(1, prefix.length)
      : prefix;

    return {
      keys,
      page,
      loop: hasLoopToken,
      name: fnm,
      place: str => {
        if (str.endsWith(path.sep) && suffix.startsWith('.')) {
          return cleanPrefix.concat(str, INDEX_PAGE);
        }

        return cleanPrefix.concat(str, suffix);
      }
    };
  }

  return {
    name: fnm,
    page: DEFAULT_PAGE_NUMBER
  };
}

export function spliceCodeSnippet(code, lnumber, column = 0, opts = {}) {
  const multiLineString = code;
  const lines = multiLineString.split(EOL);
  opts = Object.assign({
    range: 5,
    startIndex: 0
  }, opts);

  const cut = (a, b, max) => {
    const lower = inRange(a);
    const upper = inRange(b, max);
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

  const slice = lines.map((line, i) => {
    const ln = i + 1 + opts.startIndex;

    if (ln === lnumber + opts.startIndex) {
      const c = cut(column - 1, column + 1, line.length);
      const ml = markLine(line, c.lower, c.upper + 1, line.length);
      return bold(`${ln} ${ml}`).concat(EOL);
    }

    return dim(`${ln} ${line}`).concat(EOL);
  })
    .slice(lrange.lower, lrange.upper);

  const snippet = slice.join('').concat(EOL);
  return snippet;
}

export async function processJs(config, file, out, opts = {}) {
  const _opts = Object.assign({
    libName: undefined,
    hash: true
  }, opts);

  const b = browserify({
    standalone: _opts.libName
  });

  const outpath = vpath(out);
  let to = outpath.full;

  const name = vpath(file).base;
  const srcBase = getSrcBase(config);
  const tmpfile = vpath([tmpdir, srcBase, name]).full;

  const bundle = f => new Promise((res, rej) => {
    b.add(f);
    b.bundle((err, data) => err ? rej(err) : res(data));
  });

  let minCode = await bundle(file);
  writeFile(newReadable(minCode), tmpfile);

  if (!config.isDev && _opts.hash) {
    minCode = await compress(config, tmpfile, 'js', {
      compress: true,
      mangle: true
    });
    const hash = createHash(minCode, 10);
    to = outpath.noext.concat('.', hash, outpath.ext);
  }

  b.reset();

  return {
    to,
    code: minCode
  };
}

export async function processCss(config, file, out, opts = {
  justCode: '',
  startIndex: 0
}) {
  const plugins = [
    postcssPresetEnv(),
    cssnano(),
    autoprefixer()
  ];

  !config.isDev && plugins.push(
    postCssHash({
      manifest: vpath([
        tmpdir,
        vpath(config.src).base,
        'manifest.json'
      ]).full
    })
  );

  try {
    let code = opts.justCode;
    if (file && !opts.justCode) {
      code = await asyncRead(file);
    }

    const processed = await postcss(plugins)
      .process(code, { from: file, to: out });

    return {
      to: processed.opts.to,
      code: processed.css
    };
  } catch (err) {
    if (err.name === 'CssSyntaxError') {
      const emsg = splitPathCwd(config.cwd, err.file || file)
        .concat(':', err.line + opts.startIndex, ':', err.column);

      err.snippet = await genSnippet({
        code: err.source,
        line: err.line,
        column: err.column,
        startIndex: opts.startIndex,
        title: `CssSyntaxError ${emsg} "${err.reason}"`
      });
    }

    throw err;
  }
}

function processAsset(ext, config, file, out) {
  const fns = {
    '.css': processCss,
    '.js': processJs
  };

  try {
    const fun = fns[ext];
    if (!fun) throw Error('unknown extension');

    return fun(config, file, out);
  } catch (err) {
    logger.info(ext, 'is not yet supported as an asset');
    throw err;
  }
}

export async function processWatchedAsset(config, asset, ext) {
  debuglog('parsing asset');
  const srcBase = getSrcBase(config);
  const properCwd = config.multi
    ? config.cwd
    : config.cwd + path.sep + config.src;

  for (let i = 0; i < asset.length; i++) {
    const file = asset[0];
    const fileBase = splitPathCwd(properCwd, file);
    const exists = keep.get(fileBase);

    // only parse asset if it exists
    // meaning it has already been parsed by reading it from an html file
    if (exists) {
      const outputPath = vpath([config.owd, config.output.path, srcBase, fileBase]).full;
      const processed = await processAsset(ext, config, file, outputPath);

      if (processed) {
        const res = {
          from: fileBase,
          to: vpath(processed.to).base,
          code: processed.code,
          out: processed.to
        };

        writeFile(newReadable(res.code), res.out);
        logger.info('processed asset', `"${fileBase}"`);
      } else {
        logger.error('failed processing asset');
      }
    }
  }

  return asset;
}

export async function processLinkedAssets(config, assets) {
  const srcBase = getSrcBase(config, false);
  // and the h is for helper
  const h = list => {
    const ps = list.map(async item => {
      const ext = item.ext;
      const entry = item.href || item.src;
      const exists = keep.get(entry);

      if (!exists) {
        const file = item.assetPath;
        const outputPath = vpath([config.owd, config.output.path, srcBase, entry]).full;
        const out = await processAsset(ext, config, file, outputPath);

        if (out) {
          const passed = {
            from: entry,
            to: vpath(out.to).base,
            code: out.code,
            out: out.to
          };

          return passed;
        } else {
          logger.error('failed processing asset');
        }
      }

      return exists;
    });

    return Promise.all(ps);
  };

  const res = {};

  for (const ext in assets) {
    if (assets[ext]) {
      // list of assets of a specific extension
      const list = assets[ext];
      const data = await h(list);
      res[ext] = data;
    }
  }

  return res;
}

export function parsedNameKeysToPath(keys, locals, i = 0) {
  const _keys = keys || [];
  return _keys.reduce((acc, item) => {
    const index = Number(item.index || i);
    const data = locals[index] || locals;

    let prop = path.sep;
    if (item.key) prop = accessProperty(data, item.key);

    return vpath([acc, prop]).full;
  }, '');
}

/**
 * build pagination for raw data as an array
 * @param {object} funPagination funneled pagination config
 * @param {aray} rawData funneled data as an array
 * @returns
 */
export function paginationForRawDataArray(funPagination, rawData) {
  let pages = [];
  let metaPages = [];
  let paginate = false;

  if (isObj(funPagination)) {
    const every = funPagination.every;
    paginate = every && typeof every === 'number' && every <= rawData.length;

    // pages is a list of list partitioned in 'every' chunks
    pages = paginate
      ? partition(rawData, every)
      : [];
  }

  const pageCount = inRange(pages.length);
  metaPages = Array.from(
    { length: pageCount },
    (_, i) => {
      const entry = i + 1;
      return {
        no: entry,
        url: formatPageEntry(entry)
      };
    });

  return {
    metaPages,
    paginate,
    pages
  };
}
