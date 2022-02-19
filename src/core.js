import cons from 'consolidate';
import browserSync from 'browser-sync';
import chokidar from 'chokidar';
import del from 'del';
import { ESLint } from 'eslint';
import * as marky from 'marky';
import { bold, strikethrough, blue } from 'colorette';

// node
import { Readable } from 'stream';
import { EOL } from 'os';

// local

import {
  validateAndUpdateHtml
} from './utils/parse.js';

import {
  LOOP_TOKEN,
  INDEX_PAGE,
  LOCALES_PATH_NAME,
  LOCALES_SEP,
  DEFAULT_PAGE_NUMBER,
  STATIC_PATH_NAME
} from './utils/constants.js';

import { bundleSearchFeature, buildIndexes } from './utils/search.js';
import { asyncRead, htmlsNamesGenerator, writeFile } from './utils/stream.js';

import {
  vpath,
  getDirPaths,
  getSrcBase,
  splitPathCwd
} from './utils/path.js';

import {
  parseDynamicName,
  parsedNameKeysToPath,
  processWatchedAsset,
  paginationForRawDataArray
} from './utils/process.js';

import {
  handleThrown,
  loadUserEnv,
  logger,
  debuglog,
  toggleDebug,
  tmpdir
} from './utils/init.js';

import {
  safeFun,
  markyStop,
  reduceViewsByChecksum,
  showTime,
  arrayValueAt,
  formatPageEntry,
  inRange,
  getDataItemPageClosure,
  isDef,
  isObj,
  genSnippet
} from './utils/helpers.js';

import * as bSync from './utils/bs.middleware.js';
import * as keep from './utils/keep.js';
import defaultConfig from './default.config.js';

// quick setup

const userEnv = loadUserEnv();
debuglog(userEnv);

// ++++++++++++++++
// HELPERS
// ++++++++++++++++

async function compileView(config, file, locals) {
  const filePath = vpath(file);
  const name = config.views.engine.name ?? 'handlebars';
  const eConfig = safeFun(config.views.engine.config);

  try {
    // the consolidated template engine
    const engine = cons[name];
    // expose the actual template engine being internally used
    let actualEngine = await import(name);
    actualEngine = actualEngine.default || actualEngine;
    // expose
    eConfig(actualEngine);

    return await engine(filePath.full, locals);
  } catch (err) {
    // some engine error literals
    const isParsingError = err.message.startsWith('Parse');
    const lineNumberPrefix = 'line ';

    if (isParsingError) {
      const maybe = err.message.split(lineNumberPrefix)[1];
      const line = parseInt(maybe, 10);
      err.snippet = await genSnippet({
        line,
        title: `CompileViewError ${err.message}`
      }, file);
      delete err.stack; // not needed here
    }

    err.name = 'CompileViewError';
    throw err;
  }
}

async function funnel(config, file, flags = { onlyNames: false }) {
  debuglog('funnel data to', file);
  const parsed = parseDynamicName(vpath(file).base);
  const funneled = config.funneled;

  const withView = async(name, locals) => {
    if (flags.onlyNames) return;
    return compileView(config, name, locals);
  };

  const getItemPage = getDataItemPageClosure(config);
  const getPrevItemPage = getDataItemPageClosure(config);
  const getNextItemPage = getDataItemPageClosure(config);

  const funnelViewWparsedName = async(locals, itemIndex = null, opts = {}) => {
    const _opts = Object.assign({
      list: [], pageNo: null
    }, opts);

    // for looped dynamic names an index is given
    // but it may be totally skipped for other cases
    const index = itemIndex ? itemIndex : 0;
    // evaluate dynamic and non dynamic names
    let pathName = parsed.name;
    if (parsed.place) {
      const prop = parsedNameKeysToPath(parsed.keys, locals.raw, index);
      pathName = parsed.place(prop);
    }

    const srcView = vpath([config.cwd, config.src, parsed.name]).full;
    let pageEntry = '';

    const _locals = {
      raw: locals.raw,
      locales: locals.locales,
      meta: locals.meta,
      partials: locals.partials
    };

    const _pageNo = _opts.pageNo || parsed.page;

    // dynamic names may contain page numbers as a prefix
    // do a clean up here so the output name is corrent
    if (pathName.startsWith(_pageNo)) {
      pathName = pathName.split(_pageNo)[1];
    }

    if (!isDef(itemIndex)) {
      pageEntry = formatPageEntry(_pageNo);

      // page index is zero based
      const currPageIndex = inRange(_pageNo - 1);
      const pageCount = locals.pages.length;

      // the minimun range value for the previous page
      // is 1 if the current page index is 0
      // is the current index otherwise because
      // since the current index is zero based
      // numerically is the same as the previous page
      const prevPage = inRange(currPageIndex - 1, pageCount, currPageIndex || 1);
      const nextPage = inRange(currPageIndex + 2, pageCount, 1);

      _locals.pages = locals.pages;
      _locals.page = locals.pages[currPageIndex];
      _locals.prevPage = {
        no: prevPage,
        url: formatPageEntry(prevPage)
      };

      _locals.nextPage = {
        no: nextPage,
        url: formatPageEntry(nextPage)
      };
    }

    if (isDef(itemIndex)) {
      pageEntry = getItemPage(index);
      const prevEntry = getPrevItemPage(inRange(index - 1, _opts.list.length, 1));
      const nextEntry = getNextItemPage(inRange(index + 1, _opts.list.length - 1));

      _locals.data = locals.raw[index];

      _locals.prev = {
        data: arrayValueAt(_opts.list, index - 1),
        url: vpath([prevEntry,
          parsed.place(parsedNameKeysToPath(parsed.keys, locals.raw, inRange(index - 1)))
        ]).full
      };

      _locals.next = {
        data: arrayValueAt(_opts.list, index + 1),
        url: vpath([nextEntry,
          parsed.place(parsedNameKeysToPath(parsed.keys, locals.raw,
            inRange(index + 1, _opts.list.length - 1)))
        ]).full
      };
    }

    return {
      name: vpath([pageEntry, pathName]).full,
      html: await withView(srcView, _locals)
    };
  };

  const isArray = Array.isArray(funneled.raw);
  if (parsed.loop && isArray) {
    const ps = funneled.raw.map((_, i, arr) =>
      funnelViewWparsedName(funneled, i, {
        list: arr
      })
    );

    const res = await Promise.all(ps);

    return {
      htmls: res.map(r => r.html),
      names: res.map(r => r.name)
    };
  }

  // auto generate an index for each page for pagination
  const isPaginationHomePage = parsed.page === DEFAULT_PAGE_NUMBER
    && parsed.name === INDEX_PAGE && config.paginate;

  if (!isPaginationHomePage && (!parsed.keys || !parsed.loop && parsed.keys)) {
    const res = await funnelViewWparsedName(funneled);
    return {
      htmls: [res.html],
      names: [res.name]
    };
  }

  if (isPaginationHomePage && !parsed.keys) {
    marky.mark('pagination indexes');

    const len = funneled.pages.length;
    const ps = Array.from({ length: len },
      (_, i) => funnelViewWparsedName(funneled, null, {
        pageNo: parsed.page + i
      }));

    const res = await Promise.all(ps);
    markyStop('pagination indexes', end => {
      debuglog('generated', len, 'pages', `${end}s`);
    });

    return {
      htmls: res.map(r => r.html),
      names: res.map(r => r.name)
    };
  }
}

async function getLocales(config, files) {
  marky.mark('get locales');

  const dotjson = files['.json'] || [];
  const locales = dotjson.filter(file =>
    file.includes(`/${LOCALES_PATH_NAME}/`)
    && file.endsWith('.json')
  );

  // const fromConfig = config.locales.map

  const localesProm = locales.map(async locale => {
    const url = new URL(locale, import.meta.url);

    const contents = JSON.parse(
      await asyncRead(url)
    );

    const name = vpath(locale).name;
    const [lang, region] = name.split(LOCALES_SEP);

    return {
      contents,
      locale: name,
      lang,
      region
    };
  });

  const fromFiles = await Promise.all(localesProm);
  const contents = fromFiles
    .reduce((acc, item) => Object.assign(acc, { [item.locale]: item.contents }), {});

  const res = {
    meta: fromFiles,
    locales: contents
  };

  markyStop('get locales', end => {
    const lap = markyStop('build time');
    const time = showTime(end, lap);
    logger.success('loaded', fromFiles.length, LOCALES_PATH_NAME, time);
  });

  return res;
}

async function parseViews(config, views) {
  debuglog('parsing src views');

  const srcBase = getSrcBase(config);
  const outputPath = vpath([config.owd, config.output.path]);

  const _views = await Promise.all(
    await views.reduce(reduceViewsByChecksum(config, () => watch(config)), [])
  );

  debuglog('registered partials', config.funneled.partials);
  debuglog('views count', _views.length);

  if (!config.watch) {
    const cleaned = await del(
      [`${outputPath.full}/**`, `!${outputPath.full}`]
    );
    debuglog('clean output', cleaned);
  }

  const loop = arr => arr.map(async view => {
    const viewPath = vpath(view.path);
    const checksum = view.checksum;

    const { htmls, names } = await funnel(config, viewPath.full);

    const rs = Readable.from(htmlsNamesGenerator(htmls, names));
    for await (const chunk of rs) {
      marky.mark('build views');

      const _ps = chunk.htmls.map(async(html, j) => validateAndUpdateHtml(config, {
        html,
        name: chunk.names[j],
        srcBase,
        outputPath,
        count: htmls.length,
        viewPath: viewPath.full
      }));

      if (_ps.length) {
        debuglog('parsed and output', _ps.length);
        Promise.all(_ps);

        markyStop('build views', end => {
          const lap = markyStop('build time');
          const time = showTime(end, lap);
          logger.success(`"${viewPath.base}" -`, _ps.length, time);
        });
      }
    }

    return checksum;
  });

  // separate some special views
  const isIndex = s => INDEX_PAGE.startsWith(s);

  // separate costly operations
  // by splitting views that generate multiple pages and single pages
  const isMultiple = s => !isIndex(s) && s.startsWith(LOOP_TOKEN);
  const isSingle = s => !isIndex(s) && !s.startsWith(LOOP_TOKEN);

  const single = _views.filter(v => isSingle(vpath(v.path).name));
  const multiple = _views.filter(v => isMultiple(vpath(v.path).name));
  const index = _views.filter(v => isIndex(vpath(v.path).name));

  debuglog('single page view', single.length);
  debuglog('multiple pages view', multiple.length);

  // independly resolve all pages
  Promise.all(loop(single));
  Promise.all(loop(multiple));
  Promise.all(loop(index));

  return _views;
}

async function handleStaticAssets(config, files) {
  marky.mark('static assets');

  const _files = files.static || [];

  if (!_files.length) return;

  const out = vpath([
    config.owd,
    config.output.path,
    getSrcBase(config, false)
  ]);

  try {
    const ps = _files.map(async file => {
      const _static = file;
      const exists = keep.get(_static);

      if (!exists) {
        const dest = out.join(_static.split(STATIC_PATH_NAME)[1]).full;
        // fails if path exists
        await writeFile(_static, dest, null, { flags: 'wx' });
        keep.add(_static, { proc: true });
      }
    });

    Promise.all(ps);

    markyStop('static assets', end => {
      const lap = markyStop('build time');
      const time = showTime(end, lap);
      logger.success('copied static assets -', _files.length, time);
    });
  } catch (err) {
    throw err;
  }
}

async function getFunneled(config, cacheBust = '') {
  // if no config.funnel
  const dataPath = vpath([config.cwd, config.src, defaultConfig.funnelName], true).full;
  const cb = cacheBust || '';
  const url = `${dataPath}?bust=${cb}`;

  debuglog('funnel data path', dataPath);
  debuglog('funneled data cache bust', cacheBust);
  debuglog('funneled data url', url);

  try {
    const imported = await import(url);
    const funneled = 'default' in imported ? imported.default : imported;
    let previewKeys = [];

    if (funneled) {
      if (!funneled.raw) funneled.raw = [];
      funneled.meta = {};
      funneled.partials = {};

      if (Array.isArray(funneled.raw)) {
        previewKeys = Object.keys(funneled.raw[0]);
        const {
          metaPages, pages, paginate
        } = paginationForRawDataArray(funneled.pagination, funneled.raw);

        funneled.pages = paginate ? pages : [funneled.raw];
        funneled.meta.pages = metaPages;
        // expedite
        config.paginate = paginate;
      }

      if (isObj(funneled.raw)) {
        previewKeys = Object.keys(funneled.raw || {});
      }

      debuglog('preview funneled data', previewKeys);
      return funneled;
    }

    throw new Error(`invalid funneled data ${bold(funneled)}`);
  } catch (err) {
    err.name = 'DataFunnelError';
    err.message = dataPath.concat('\n\n', err.message);
    throw err;
  }
}

async function readSource(src) {
  const files = await getDirPaths(src, 'full');
  debuglog('source data', files);

  const classified = files.reduce((acc, file) => {
    const ext = vpath(file).ext;
    const isStatic = file.includes(`/${STATIC_PATH_NAME}/`);

    if (isStatic) {
      acc.static.push(file);
      return acc;
    }

    if (!acc[ext]) {
      acc[ext] = [file];
    } else {
      acc[ext].push(file);
    }

    return acc;
  }, { static: [] });

  debuglog('files classified by extension', classified);
  return classified;
}

async function unlinkFiles(config, toDel) {
  marky.mark('deleting files');

  const delp = vpath(toDel);
  config.funneled = await getFunneled(config);

  const { names } = await funnel(config, delp.full, {
    onlyNames: true
  });

  const srcBase = getSrcBase(config, false);
  const fnms = names.map(nm => vpath([
    config.owd,
    config.output.path,
    srcBase,
    nm
  ]).full);

  try {
    const deld = await del(fnms, { force: true });

    deld.length && markyStop('deleting files', end => {
      const label = strikethrough(delp.base);
      const count = names.length;
      logger.success(`"${label}" -`, count, `- ${end}s`);
    });
  } catch (err) {
    throw err;
  }
}

// +++++++++++++++++++++++++++++++
// RUN WITH CONFIG
// +++++++++++++++++++++++++++++++

function withConfig(config, done) {
  process.on('uncaughtException', handleThrown(config));
  process.on('unhandledRejection', handleThrown(config));

  toggleDebug(config.build.debug);
  debuglog('user config %O', config);

  config.watch = ['watch', 'serve'].includes(done.name);

  // output working directory
  config.owd = config.cwd;
  if (config.watch) {
    const nm = 'tmpout';
    config.owd = tmpdir;
    config.output.path = nm;
  }

  config.env = process.env.NODE_ENV;
  config.isDev = config.env !== 'production';

  debuglog('user environment "%s"', config.env);
  debuglog('watch mode', config.watch);
  debuglog('output working directory', config.owd);
  debuglog('public output directory', config.output.path);

  const outputPath = vpath([config.owd, config.output.path]).full;
  del(outputPath, { force: true })
    .then(cleaned => {
      debuglog('init! cleaned output', cleaned);
    });

  return done(config);
}

// ++++++++++++++++
// INTERFACE
// ++++++++++++++++

async function gen(config, watching = null, ext) {
  marky.mark('build time');

  const funCacheBust = config.watchFunnel ? Date.now() : null;

  if (!config.funneled || funCacheBust) {
    config.funneled = await getFunneled(config, funCacheBust);
  }

  const srcPath = vpath([config.cwd, config.src]);
  const read = await readSource(srcPath.full);
  // files read from source or currently being watched
  const files = watching || read;
  const views = config.watchFunnel ? read['.html'] : files['.html'] || [];

  if (watching && ext !== '.html' && !config.watchFunnel) {
    const asset = watching[ext] || [];
    return await processWatchedAsset(config, asset, ext);
  }

  if (!config.funneled.locales) {
    const { locales, meta } = await getLocales(config, read);
    config.funneled.locales = locales;
    config.funneled.meta.locales = meta;
  }

  buildIndexes(config);
  bundleSearchFeature(config);

  try {
    const parsed = await parseViews(config, views);
    await handleStaticAssets(config, files);
    return parsed;
  } catch (e) {
    throw e;
  }
}

/**
 * Watches changes on the templates
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {object} config user configurations
 * @param {Function} cb Runs on triggered events
 */
async function watch(config, cb = () => {}) {
  const watchPath = vpath([config.cwd, config.src], true);
  const _cb = safeFun(cb);

  const watcher = chokidar.watch([
    `${watchPath.full}/**/*.html`,
    `${watchPath.full}/**/*.css`,
    `${watchPath.full}/**/*.js`,
    `${watchPath.full}/**/*.mjs`,
    `${watchPath.full}/static/*.*`
  ], {
    ignored: []
  });

  watcher.on('ready', () => {
    logger.info(blue('watching'),
      splitPathCwd(config.cwd, watchPath.full), EOL);
    gen(config);
    _cb();
  });

  const run = p => {
    debuglog('altered', p);
    const ext = vpath(p).ext;
    const watching = { [ext]: [p] };

    const isFunnel = p.endsWith(defaultConfig.funnelName);
    config.watchFunnel = isFunnel && config.build.watchFunnel;

    const isStatic = p.includes(`/${STATIC_PATH_NAME}/`);
    if (isStatic) watching.static = [p];

    gen(config, watching, ext)
      .then(res => {
        res.length && _cb();
      });
  };

  const unl = async p => {
    debuglog('deleting', p);
    const fp = vpath([config.cwd, p]).full;
    unlinkFiles(config, fp);
    _cb();
  };

  watcher
    .on('change', run)
    .on('addDir', run)
    .on('unlink', unl)
    // .on('unlinkDir', unlink)
    .on('error', err => {
      throw err;
    });
}

/**
 * Starts a development server.
 * Powered by [BrowserSync](https://browsersync.io/docs/api)
 */
async function serve(config) {
  const serverRoot = vpath([config.owd, config.output.path]).full;

  const fallbackPagePath = config.devServer.pages['404'];
  const port = config.devServer.port ?? 2000;
  const host = 'http://localhost';
  const entry = config.src;

  const bs = browserSync({
    port,
    open: config.devServer.open,
    notify: false,
    online: false,
    server: {
      baseDir: serverRoot,
      directory: config.devServer.directory,
      serveStaticOptions: {
        redirect: true
      }
    },
    middleware: bSync.middlewareList({
      host, port, entry, serverRoot
    }),
    /**
     * @see https://browsersync.io/docs/options/#option-callbacks
     */
    callbacks: {
      ready(err, _bs) {
        if (err) throw err;
        _bs.addMiddleware('*', bSync.restMiddleware(fallbackPagePath));
      }
    }
  });

  watch(config, bs.reload);
}

async function lint(config) {
  debuglog('linting source code');
  debuglog('auto fix linting', config.lint.fix);
  debuglog('linting cwd', config.cwd);

  const eslint = new ESLint({
    fix: config.lint.fix,
    cwd: config.cwd,
    overrideConfigFile: config.lint.esrc
  });

  try {
    const res = await eslint.lintFiles(config.src);
    // update linted files
    await ESLint.outputFixes(res);
    // format res for stdout
    const fmtr = await eslint.loadFormatter('stylish');
    const text = fmtr.format(res);
    text.length && logger.log(text);
  } catch (err) {
    throw err;
  }
}

export default {
  gen: c => withConfig(c, gen),
  watch: c => withConfig(c, watch),
  serve: c => withConfig(c, serve),
  lint: c => withConfig(c, lint)
};
