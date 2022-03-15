import { bold, red, dim, reset } from 'colorette';
import esbuild from 'esbuild';

// postcss and plugins
import postcss from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import postCssHash from 'postcss-hash';
import postCssSass from 'postcss-sass';
import postCssScss from 'postcss-scss';

// node
import { EOL } from 'os';
import path from 'path';

// local
import {
  createHash,
  inRange,
  partition,
  isObj,
  formatPageEntry,
  getSnippet
} from './helpers.js';

import {
  debuglog,
  logger
} from './init.js';

import { vpath, getSrcBase, splitPathCwd, pathDistance } from './path.js';
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
import { tmpFile } from './tmp.js';

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
  if (!fnm) return;

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

export function generateCodeSnippet(code, lnumber, opts = {}) {
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

  const markLine = s => {
    const p = String().padStart(s.length)
      .concat(bold(red('^^^^^^')));

    return s.concat(EOL, p, EOL);
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
      const ml = markLine(line);
      const out = bold(`${ln} \u00b7 ${ml}`);
      return out;
    }

    let res = dim(`${ln} \u00b7 ${line}`).concat(EOL);
    // max line length
    if (res.length > 100) res = res.substring(0, 100).concat('...');

    return reset(res);
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

  const outpath = vpath(out);
  const input = vpath(file);
  let to = outpath.full;

  const res = await esbuild.build({
    entryPoints: [input.full],
    bundle: true,
    write: false,
    charset: 'utf8',
    format: 'iife',
    target: [
      'es6'
    ],
    sourcemap: !config.isDev,
    legalComments: 'inline',
    globalName: _opts.libName,
    minify: !config.isDev,
    minifyWhitespace: !config.isDev,
    minifyIdentifiers: !config.isDev,
    minifySyntax: !config.isDev,
    treeShaking: true,
    keepNames: true,
    loader: {},
    banner: {},
    footer: {}
  });

  if (!config.isDev && _opts.hash) {
    const hash = createHash(res.code, 10);
    to = outpath.noext.concat('.', hash, outpath.ext);
  }

  res.code = res.outputFiles[0].text;

  return {
    to,
    code: res.code
  };
}

const getPostCssPlugins = config => {
  const plugins = [
    postcssPresetEnv()
  ];

  if (!config.isDev) {
    plugins.concat([
      cssnano(),
      autoprefixer(),
      postCssHash({
        manifest: tmpFile('manifest.json', 'assets')
      })
    ]);
  }

  return plugins;
};

async function processScss(config, file, out) {
  try {
    const code = await asyncRead(file);
    const processed = await postcss(getPostCssPlugins(config))
      .process(code, { from: file, to: out, syntax: postCssScss });

    return {
      to: processed.opts.to,
      code: processed.css
    };
  } catch (err) {
    if (err.name === 'SassSyntaxError') {
      const emsg = splitPathCwd(config.cwd, err.file || file)
        .concat(':', err.line, ':', err.column);

      err.snippet = await getSnippet({
        code: err.source,
        line: err.line,
        column: err.column,
        title: `CssSyntaxError ${emsg} "${err.reason}"`
      });
    }

    throw err;
  }
}

async function processSass(config, file, out) {
  try {
    const code = await asyncRead(file);
    const processed = await postcss(getPostCssPlugins(config))
      .process(code, { from: file, to: out, syntax: postCssSass });

    return {
      to: processed.opts.to,
      code: processed.css
    };
  } catch (err) {
    if (err.name === 'SassSyntaxError') {
      const emsg = splitPathCwd(config.cwd, err.file || file)
        .concat(':', err.line, ':', err.column);

      err.snippet = await getSnippet({
        code: err.source,
        line: err.line,
        column: err.column,
        title: `CssSyntaxError ${emsg} "${err.reason}"`
      });
    }

    throw err;
  }
}

export async function processCss(config, file, out, opts = {
  justCode: '',
  startIndex: 0
}) {
  try {
    let code = opts.justCode;
    if (file && !opts.justCode) {
      code = await asyncRead(file);
    }

    const processed = await postcss(getPostCssPlugins(config))
      .process(code, { from: file, to: out });

    return {
      to: processed.opts.to,
      code: processed.css
    };
  } catch (err) {
    if (err.name === 'CssSyntaxError') {
      const emsg = splitPathCwd(config.cwd, err.file || file)
        .concat(':', err.line + opts.startIndex, ':', err.column);

      err.snippet = await getSnippet({
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
    '.sass': processSass,
    '.scss': processScss,
    '.js': processJs,
    '.mjs': processJs
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
        debuglog('processed asset', `"${fileBase}"`);
      } else {
        debuglog('failed processing asset');
      }
    }
  }

  return asset;
}

export async function processLinkedAssets(config, html, assets) {
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
            to: pathDistance(html.out, out.to).distance,
            code: out.code,
            out: out.to
          };

          keep.add(entry, { ...passed, htmls: [html.from] });
          keep.appendAssetTo(html.from, passed);

          writeFile(newReadable(passed.code), passed.out, () => {
            // console.log('done');
          });
          return passed;
        } else {
          debuglog('failed processing asset');
          return item;
        }
      }

      exists.to = pathDistance(html.out, exists.out).distance;
      exists.htmls.push(html.from);
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
 * @param {array} rawData funneled data as an array
 */
export function paginationForPagesArray(funPagination, rawData = []) {
  let pages = [];
  let flatPages = [];
  let metaPages = [];
  let paginate = false;

  if (isObj(funPagination)) {
    const every = funPagination.every;
    const _pages = funPagination.pages;
    // pagination pages or raw array for pages
    const rdata = _pages && Array.isArray(_pages) ? _pages : rawData || [];

    paginate = every && typeof every === 'number' && every <= rdata.length;

    // pages is a list of lists partitioned in 'every' chunks
    pages = paginate
      ? partition(rdata, every)
      : [rdata];

    // rdata is assumed to be a flat array, but for my sanity
    // and since this is a user input just flatten it
    flatPages = rdata.flat();
  }

  if (paginate) {
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
  }

  return {
    metaPages,
    paginate,
    flatPages,
    pages
  };
}
