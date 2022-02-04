import htmlValidator from 'html-validator';
import cheerio from 'cheerio';
import browserify from 'browserify';

// postcss and plugins
import postcss from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import postCssHash from 'postcss-hash';

// node
import fs from 'fs/promises';
import { EOL } from 'os';

// local
import {
  vpath,
  tmpdir,
  compress,
  createHash,
  fErrName,
  splitPathCwd,
  logger,
  spliceCodeSnippet,
  getSrcBase
} from './util.js';


export async function validateHtml(config, html, opts) {
  if (!html || typeof html !== 'string') {
    throw Error(`validateHtml() takes a html string. "${html}" given`);
  }

  try {
    const res = await htmlValidator({
      data: html,
      format: 'text',
      validator: 'WHATWG'
    });

    const msg = err => {
      const emsg = splitPathCwd(config.cwd, opts.view)
        .concat(':', err.line, ':', err.column);

      logger.log(EOL);
      logger.log('HtmlValidatorError', emsg, `"${err.ruleId}"`, err.message, EOL);
    };

    res.errors.forEach(err => {
      msg(err);
      logger.log(spliceCodeSnippet(html, err.line, err.column));
    });

    res.warnings.forEach(warn => {
      msg(warn);
      logger.log(spliceCodeSnippet(html, warn.line, warn.column));
    });

    if (!res.isValid) throw Error('HtmlValidatorError');
    return res.isValid;
  } catch (err) {
    err.name = 'HtmlValidatorError';
    throw err;
  }
}

export async function writeFile(file, data, dry = false) {
  const safeFile = vpath(file);

  const done = async() => {
    if (!dry) {
      await fs.writeFile(safeFile.full, data, {
        encoding: 'utf-8',
        flag: 'w'
      });
    }
  };

  try {
    const stats = await fs.stat(safeFile.dir);
    if (!stats.isDirectory()) {
      throw Error('Public output must be a directory');
    }

    return done();
  } catch {
    if (!dry) {
      try {
        await fs.mkdir(safeFile.dir, { recursive: true });
        return done();
      } catch (e) {
        throw e;
      }
    }
  }
}

export async function processJs(config, file, out) {
  const b = browserify();
  const outpath = vpath(out);
  let to = outpath.full;

  const name = vpath(file).base;
  const srcBase = getSrcBase(config);
  const tmpfile = vpath([tmpdir, srcBase, name]).full;

  const bundle = f => new Promise((res, rej) => {
    b.add(f);
    b.bundle((err, data) => err ? rej(err) : res(data));
  });

  const res = await bundle(file);
  await writeFile(tmpfile, res);

  const minCode = await compress(config, tmpfile, 'js', {
    compress: true,
    mangle: true
  });

  if (!config.isDev) {
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
    if (file && !opts.justCode) code = await fs.readFile(file);

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
      process.stdout.write(snippet);
      // console.log(snippet);
    }

    err.name = fErrName(err.name, 'ProcessCss', ['CssSyntaxError']);
    throw err;
  }
}

export function processAsset(ext, config, file, out) {
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

export function parseHtmlLinked(config, code) {
  const $ = cheerio.load(code);

  const linked = {};
  const addLinked = (ext, data) => {
    if (!linked[ext]) {
      linked[ext] = [data];
    } else {
      linked[ext].push(data);
    }
  };

  $('link[rel]').each((_, el) => {
    try {
      const hrefPath = vpath(
        [config.cwd, config.src, el.attribs.href],
        true
      );

      const data = {
        ext: hrefPath.ext,
        assetPath: hrefPath.full,
        ...el.attribs
      };

      addLinked(hrefPath.ext, data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        err.name = 'HtmlLinkedCssWarn';
        logger.info('file "%s" not found locally', el.attribs.href);
      }
    }
  });

  $('script[src]').each((_, el) => {
    try {
      const srcPath = vpath(
        [config.cwd, config.src, el.attribs.src],
        true
      );

      const data = {
        ext: srcPath.ext,
        assetPath: srcPath.full,
        ...el.attribs
      };

      addLinked(srcPath.ext, data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        err.name = 'HtmlLinkedScriptWarn';
        logger.info('file "%s" not found locally', el.attribs.src);
      } else {
        throw err;
      }
    }
  });

  return linked;
}

const wrapCheerioElem = m => '\n'.concat(m, '\n');

export function updatedHtmlLinkedJs(code, linkedJs) {
  const $ = cheerio.load(code);
  linkedJs = linkedJs || [];

  for (let i = 0; i < linkedJs.length; i++) {
    const it = linkedJs[i];
    const el = $(`script[src="${it.from}"]`);

    const mod = el.attr('src', it.to);
    $(el).replaceWith(wrapCheerioElem(mod));
  }

  return $.html();
}

export function updatedHtmlLinkedCss(code, linkedCss) {
  const $ = cheerio.load(code);
  linkedCss = linkedCss || [];

  for (let i = 0; i < linkedCss.length; i++) {
    const item = linkedCss[i];
    const elem = $(`link[href="${item.from}"]`);

    const modded = elem.attr('href', item.to);
    $(elem).replaceWith(wrapCheerioElem(modded));
  }

  return $.html();
}

export async function updateScriptTagJs(code) {
  const $ = cheerio.load(code);
  const scriptTags = $('script');

  for (const elem of scriptTags) {
    const innerJs = $(elem).html();
    const res = innerJs; // processJs(innerJs);
    $(elem).html(res);
  }

  return $.html();
}

export async function updateStyleTagCss(config, code, file = '') {
  const $ = cheerio.load(code);
  const styleTags = $('style');

  for (const elem of styleTags) {
    const innerCss = $(elem).html();
    // this element start index in the code
    const eIndex = code.indexOf(innerCss);
    const startIndex = code.substring(0, eIndex)
      .split(EOL).length;

    const res = await processCss(config, file, '', {
      justCode: innerCss,
      startIndex: startIndex - 1
    });
    $(elem).html(res.css);
  }

  return $.html();
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
