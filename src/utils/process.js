import { bold, red } from 'colorette';
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
import { createReadStream } from 'fs';

// local
import {
  debuglog,
  logger,
  fErrName,
  createHash,
  tmpdir,
  compress
} from './helpers.js';

import { vpath, getSrcBase, splitPathCwd } from './path.js';
import { writeFile, newReadable, asyncRead } from './stream.js';
import * as keep from './keep.js';

import {
  LOCALS_FIELD_BEGIN_TOKEN,
  LOCALS_FIELD_END_TOKEN,
  LOCALS_PATH_TOKEN,
  LOCALS_INDEX_TOKEN,
  LOCALS_LOOP_TOKEN,
  MAX_RECURSIVE_ACESS
} from './tokens.js';

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

  const slice = lines.map((line, i) => {
    const ln = i + 1 + opts.startIndex;

    if (ln === lnumber + opts.startIndex) {
      const c = cut(column - 1, column + 1, line.length);
      const ml = markLine(line, c.lower, c.upper, line.length);
      return bold(`${ln}${ml}`).concat(EOL);
    }

    return `${ln}${line}`.concat(EOL);
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
      const rs = createReadStream(file);
      code = await asyncRead(rs);
    }

    const processed = await postcss(plugins)
      .process(code, { from: file, to: out });

    return {
      to: processed.opts.to,
      code: processed.css
    };
  } catch (err) {
    if (err.name === 'CssSyntaxError') {
      const snippet = spliceCodeSnippet(err.source, err.line, 0, {
        startIndex: opts.startIndex
      });

      const emsg = splitPathCwd(config.cwd, err.file || file)
        .concat(':', err.line + opts.startIndex, ':', err.column);

      logger.log(EOL);
      logger.log('CssSyntaxError', emsg, `"${err.reason}"`, EOL);
      logger.log(snippet);
    }

    err.name = fErrName(err.name, 'ProcessCss', ['CssSyntaxError']);
    throw err;
  }
}

function processAsset(ext, config, file, out) {
  const fns = {
    '.css': processCss,
    '.js': processJs
  };

  try {
    return fns[ext](config, file, out);
  } catch {
    logger.info(ext, 'is not yet supported as an asset');
  }
}

export async function processWatchedAsset(config, asset, ext) {
  debuglog('parsing asset');
  const srcBase = getSrcBase(config);

  for (let i = 0; i < asset.length; i++) {
    const file = asset[0];
    const fileBase = splitPathCwd(config.cwd, file);
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
