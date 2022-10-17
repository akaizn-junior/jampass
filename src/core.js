import browserSync from 'browser-sync';
import chokidar from 'chokidar';
import del from 'del';
import { ESLint } from 'eslint';
import * as marky from 'marky';
import { bold, strikethrough, blue, yellow } from 'colorette';
import slugify from 'slugify';
import matter from 'gray-matter';
import { marked } from 'marked';
import sanitize from 'sanitize-html';

// node
import { Readable } from 'stream';
import { EOL } from 'os';

// local

import {
  validateAndUpdateHtml
} from './util/parse.js';

import {
  LOOP_TOKEN,
  INDEX_PAGE,
  LOCALES_PATH_NAME,
  LOCALES_SEP,
  DEFAULT_PAGE_NUMBER,
  STATIC_PATH_NAME,
  PARTIALS_PATH_NAME,
  PARTIALS_TOKEN,
  VIEWS_PATH_NAME,
  DATA_PATH_NAME,
  SCRIPT_PATH_NAME,
  STYLE_PATH_NAME,
  STATIC_PATH_EXT,
  STYLE_PATH_EXT,
  SCRIPT_PATH_EXT,
  LOCALES_PATH_EXT,
  VIEWS_PATH_EXT,
  DATA_PATH_EXT
} from './util/constants.js';

import { buildIndexes } from './util/indexes.js';
import { asyncRead, htmlsNamesGenerator, symlink, writeFile } from './util/stream.js';

import {
  vpath,
  getDirPaths,
  withSrcBase,
  splitPathCwd,
  withViewsPath
} from './util/path.js';

import {
  parseDynamicName,
  parsedNameKeysToPath,
  processEditedAsset,
  paginationForPagesArray,
  processView
} from './util/process.js';

import {
  handleThrown,
  loadUserEnv,
  logger,
  debuglog,
  toggleDebug,
  isValidSrcBase
} from './util/init.js';

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
  timeWithUnit,
  buildDataFileTree
} from './util/helpers.js';

import * as bSync from './util/server.middleware.js';
import * as keep from './util/keep.js';
import * as appConfig from './core.config.js';
import { tmpDirSync } from './util/tmp.js';

// quick setup

const userEnv = loadUserEnv();
debuglog(userEnv);

// ++++++++++++++++
// HELPERS
// ++++++++++++++++

async function funnel(config, file, flags = { onlyNames: false }) {
  debuglog('funnel data to', file);

  const parsed = parseDynamicName(vpath(file).base);
  const funneled = config.funneled;

  const withView = async(name, locals) => {
    if (flags.onlyNames) return;
    return processView(config, name, locals);
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
      const prop = parsedNameKeysToPath(parsed.keys, locals.flatPages, index);
      pathName = parsed.place(prop);
    }

    const srcView = vpath([
      config.cwd,
      config.src,
      withViewsPath(config),
      parsed.name
    ]).full;

    let pageEntry = '';
    const _pageNo = _opts.pageNo || parsed.page;

    const _locals = {
      raw: locals.raw,
      fromFiles: locals.fromFiles,
      locales: locals.locales,
      meta: locals.meta,
      partials: locals.partials,
      pageNumber: _pageNo
    };

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

      _locals.data = locals.flatPages[index];

      _locals.prev = {
        data: arrayValueAt(_opts.list, index - 1),
        url: vpath([prevEntry,
          parsed.place(parsedNameKeysToPath(parsed.keys, locals.flatPages, inRange(index - 1)))
        ]).full
      };

      _locals.next = {
        data: arrayValueAt(_opts.list, index + 1),
        url: vpath([nextEntry,
          parsed.place(parsedNameKeysToPath(parsed.keys, locals.flatPages,
            inRange(index + 1, _opts.list.length - 1)))
        ]).full
      };
    }

    return {
      name: vpath([pageEntry, pathName]).full,
      html: await withView(srcView, _locals)
    };
  };

  const isArray = Array.isArray(funneled.flatPages);
  if (parsed.loop && isArray) {
    const ps = funneled.flatPages.map((_, i, arr) =>
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
      debuglog('generated', len, 'pages', timeWithUnit(end));
    });

    return {
      htmls: res.map(r => r.html),
      names: res.map(r => r.name)
    };
  }
}

// ++++++++++++++++
// HANDLERS
// ++++++++++++++++

async function handleLocales(config, files) {
  marky.mark('get locales');

  const locales = files.locales;

  if (!locales.length) return {};

  // const fromConfig = config.locales.map

  const localesProm = locales.map(async locale => {
    const url = new URL(locale, import.meta.url);
    let contents = '';

    try {
      contents = JSON.parse(
        await asyncRead(url)
      );
    } catch (err) {
      const known = ['SyntaxError'];
      if (!known.includes(err.name)) {
        throw err;
      }
      contents = {};
    }

    const fileName = vpath(locale);
    let localeName = fileName.name;

    if (fileName.base.endsWith(LOCALES_PATH_EXT[1])) {
      localeName = fileName.base.split(LOCALES_PATH_EXT[1])[0];
    }

    const [lang, region] = localeName.split(LOCALES_SEP);

    return {
      contents,
      locale: localeName,
      lang,
      region: region ?? null
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
    debuglog('loaded', fromFiles.length, LOCALES_PATH_NAME, time);
  });

  debuglog('locales', res);
  return res;
}

async function handleViews(config, files, read) {
  debuglog('parsing src views');

  const views = config.bypass
    ? read.views
    : files['.html'] || [];

  const srcBase = withSrcBase(config);
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
          logger.log(`"${viewPath.base}" -`, _ps.length, time);
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

async function handleStaticFiles(config, files) {
  marky.mark('static files');

  const _files = files.static || [];

  if (!_files.length) return;

  const out = vpath([
    config.owd,
    config.output.path,
    withSrcBase(config, false)
  ]);

  try {
    const ps = _files.map(async file => {
      const _static = vpath(file);
      const exists = keep.get(_static);

      if (!exists) {
        const [_name] = _static.name.split(STATIC_PATH_EXT);
        const [, _dir] = _static.dir.split(STATIC_PATH_NAME);
        const destName = _name.concat(_static.ext);

        const dest = out.join(_dir ?? '', destName).full;

        if (config.isDev) {
          await symlink(_static.full, dest);
        } else {
          // fails if path exists
          await writeFile(_static.full, dest, null, { flags: 'wx' });
        }

        keep.add(_static.full, { proc: true });
      }
    });

    Promise.all(ps);

    markyStop('static files', end => {
      const lap = markyStop('build time');
      const time = showTime(end, lap);
      debuglog('copied static files -', _files.length, time);
    });
  } catch (err) {
    throw err;
  }
}

function handleData(config, funneled) {
  let previewKeys = [];
  // reserved keys
  funneled.meta = {};
  funneled.partials = {};

  if (Array.isArray(funneled.raw)) {
    previewKeys = Object.keys(funneled.raw[0] ?? {});
    const {
      metaPages, pages, flatPages, paginate
    } = paginationForPagesArray(funneled.pagination, funneled.raw);

    funneled.pages = pages;
    funneled.flatPages = flatPages;
    funneled.meta.pages = metaPages;
    // expedite
    config.paginate = paginate;
  }

  if (isObj(funneled.raw)) {
    previewKeys = Object.keys(funneled.raw || {});
    const _fpages = funneled.pagination?.pages || [];

    if (Array.isArray(_fpages)) {
      const {
        metaPages, pages, flatPages, paginate
      } = paginationForPagesArray(funneled.pagination);

      funneled.pages = pages;
      funneled.flatPages = flatPages;
      funneled.meta.pages = metaPages;
      // expedite
      config.paginate = paginate;
    }
  }

  debuglog('preview funneled data', previewKeys);
  return funneled;
}

async function unlinkFiles(config, toDel) {
  marky.mark('deleting files');

  // path to delete
  const delp = vpath(toDel);
  config.funneled = await readData(config);

  const { names } = await funnel(config, delp.full, {
    onlyNames: true
  });

  const srcBase = withSrcBase(config, false);
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
      debuglog(`"${label}" -`, count, `- ${timeWithUnit(end)}`);
    });
  } catch (err) {
    throw err;
  }
}

// ++++++++++++++++
// READERS
// ++++++++++++++++

async function readDataFiles(config, files) {
  // and the h is for helper
  async function h(f) {
    const p = vpath(f);
    const slug = slugify(p.name, { lower: true });

    const tmp = {
      _name: p.name,
      _slug: {
        name: slug,
        hash: `#${slug}`
      },
      content: '',
      _read: await asyncRead(p.full)
    };

    tmp.matter = matter(tmp._read);

    if (p.ext === '.md') {
      tmp.content = sanitize(marked(tmp.matter.content ?? ''));
    }

    if (p.ext === '.txt') {
      tmp.content = sanitize(tmp.matter.content ?? '');
    }

    const data = Object.assign({
      name: tmp._name,
      slug: tmp._slug
    },
    // override default keys
    tmp.matter.data,
    // must override any 'content' key in the front matter
    { content: tmp.content }
    );

    return data;
  }

  const filesData = await buildDataFileTree(config, files, h);

  return filesData;
}

async function readData(config, fromFiles, cacheBust = '') {
  const dKeys = appConfig.dataFileSchema;

  try {
    // if no config.funnel
    const funnelPath = vpath([config.cwd, config.src, appConfig.__jsDataFile], true).full;
    const cb = cacheBust || '';
    const url = `${funnelPath}?bust=${cb}`;

    debuglog('funnel data path', funnelPath);
    debuglog('funneled data cache bust', cacheBust);
    debuglog('funneled data url', url);

    const imported = await import(url);

    // consolidate funneled
    const funneled = Object.assign({
      raw: dKeys.raw.default
    }, imported);

    funneled.fromFiles = await readDataFiles(config, fromFiles);

    return funneled;
  } catch (err) {
    if (fromFiles.length) {
      dKeys.fromFiles = await readDataFiles(config, fromFiles);
      return dKeys;
    }

    err.name = 'DataFunnelError';
    if (err.code === 'ENOENT') {
      // if no 'jampass.data.js' found
      // or any data file read
      // return default keys with default values
      return dKeys;
    }

    throw err;
  }
}

async function readSource(src) {
  const files = await getDirPaths(src, 'full');
  debuglog('source data', files);

  const classified = files.reduce((acc, file) => {
    const _file = vpath(file);
    const ext = _file.ext;
    const name = _file.name;
    const dir = _file.dir;

    const isFunnel = file.endsWith(appConfig.__jsDataFile);
    const isStatic = dir.includes(STATIC_PATH_NAME) || name.endsWith(STATIC_PATH_EXT);

    const isLocale = dir.includes(LOCALES_PATH_NAME) && _file.base.endsWith(LOCALES_PATH_EXT[0])
      || _file.base.endsWith(LOCALES_PATH_EXT[1]);

    const isView = dir.includes(VIEWS_PATH_NAME) || VIEWS_PATH_EXT.some(e => file.endsWith(e));
    const isData = dir.includes(DATA_PATH_NAME) || DATA_PATH_EXT.some(e => file.endsWith(e));
    const isPartial = dir.includes(PARTIALS_PATH_NAME) || name.startsWith(PARTIALS_TOKEN);
    const isScript = !isFunnel && (dir.includes(SCRIPT_PATH_NAME) || SCRIPT_PATH_EXT.some(e => file.endsWith(e)));
    const isStyle = dir.includes(STYLE_PATH_NAME) || STYLE_PATH_EXT.some(e => file.endsWith(e));

    if (isStatic) acc.static.push(file);
    if (isLocale) acc.locales.push(file);
    if (isView) acc.views.push(file);
    if (isPartial) acc.partials.push(file);
    if (isScript) acc.scripts.push(file);
    if (isStyle) acc.styles.push(file);
    if (isData) acc.data.push(file);

    if (!acc[ext]) acc[ext] = [file];
    else acc[ext].push(file);

    return acc;
  }, {
    static: [],
    data: [],
    views: [],
    locales: [],
    partials: [],
    scripts: [],
    styles: []
  });

  debuglog('files classified by kind and extension', classified);
  return classified;
}

// +++++++++++++++++++++++++++++++
// RUN WITH CONFIG
// +++++++++++++++++++++++++++++++

async function withConfig(config, done) {
  process.on('uncaughtException', handleThrown(config));
  process.on('unhandledRejection', handleThrown(config));

  // verify if user directory is a valid source
  isValidSrcBase(config);

  toggleDebug(config.build.debug);
  debuglog('user config %O', config);

  config.watch = ['watch', 'serve'].includes(done.name);

  // output working directory
  config.owd = config.cwd;
  if (config.watch) {
    // the full source path is a suficiently unique name
    // to base a temporary name from
    const uname = vpath([config.cwd, config.src]).full;
    const tempo = tmpDirSync(uname);
    config.owd = tempo;
    config.output.path = '';
  }

  config.env = config.env || process.env.NODE_ENV;
  config.isDev = config.env !== 'production';

  debuglog('user environment "%s"', config.env);
  debuglog('watch mode', config.watch);
  debuglog('output working directory "%s"', config.owd);
  debuglog('public output directory "%s"', config.output.path);

  const outputPath = vpath([config.owd, config.output.path]).full;
  const cleaned = await del(outputPath, { force: true });
  debuglog('init! cleaned output', cleaned);

  return done(config);
}

// ++++++++++++++++
// INTERFACE
// ++++++++++++++++

async function gen(config, watching = null, ext = null, done = () => {}) {
  marky.mark('build time');

  const srcPath = vpath([config.cwd, config.src]);
  const read = await readSource(srcPath.full);
  const funnelCacheBust = config.datawatch ? Date.now() : null;

  if (!config.funneled || funnelCacheBust) {
    config.funneled = handleData(config, await readData(config, read.data, funnelCacheBust));
  }

  // files read from source or currently being watched
  const files = watching || read;

  if (watching && ext !== '.html' && !config.datawatch) {
    const asset = watching[ext] || [];
    return await processEditedAsset(config, asset, ext);
  }

  const locales = await handleLocales(config, read);

  if (!config.funneled.locales) {
    config.funneled.locales = locales.locales || {};
    config.funneled.meta.locales = locales.meta || [];
  }

  try {
    buildIndexes(config);
    await handleViews(config, files, read);
    await handleStaticFiles(config, files);
    safeFun(done)();
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
async function watch(config, cb = () => {}, { customLog = false } = {}) {
  const watchPath = vpath([config.cwd, config.src], true);
  const _cb = safeFun(cb);

  const watcher = chokidar.watch([
    `${watchPath.full}/**/*.html`,
    `${watchPath.full}/**/*.htm`,
    `${watchPath.full}/**/*.css`,
    `${watchPath.full}/**/*.sass`,
    `${watchPath.full}/**/*.scss`,
    `${watchPath.full}/**/*.js`,
    `${watchPath.full}/**/*.mjs`,
    `${watchPath.full}/data/*.md`,
    `${watchPath.full}/data/*.txt`,
    `${watchPath.full}/*.data.md`,
    `${watchPath.full}/*.data.txt`,
    `${watchPath.full}/static/*.*`,
    `${watchPath.full}/*.static.*`,
    `${watchPath.full}/locales/*.*`,
    `${watchPath.full}/*.locale.json`
  ], {
    ignored: []
  });

  const announce = () => {
    const msg = customLog ? customLog
      : blue(`Watching ${splitPathCwd(config.cwd, watchPath.full)}`);
    logger.log(msg, EOL);
  };

  watcher.once('ready', () => {
    gen(config, null, null, announce);
    _cb();
  });

  const run = p => {
    debuglog('altered', p);
    const _p = vpath(p);
    const ext = _p.ext;
    const watching = { [ext]: [p] };

    const isFunnel = p.endsWith(appConfig.funnelName);
    const isData = _p.dir.includes(DATA_PATH_NAME)
      || DATA_PATH_EXT.some(e => p.endsWith(e));
    config.watchFunnel = (isFunnel || isData) && config.build.watchFunnel;

    const isPartial = p.includes(PARTIALS_PATH_NAME)
      || vpath(p).name.startsWith(PARTIALS_TOKEN);

    const isLocale = p.includes(LOCALES_PATH_NAME)
    && _p.base.endsWith(LOCALES_PATH_EXT[0])
      || _p.base.endsWith(LOCALES_PATH_EXT[1]);

    config.bypass = isPartial || isLocale || config.watchFunnel;

    debuglog('bypass checksum check', config.bypass);

    const isStatic = p.includes(STATIC_PATH_NAME);
    if (isStatic) watching.static = [p];

    gen(config, watching, ext, announce);
    _cb();
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
  const port = config.devServer.port || 2000;
  const host = config.devServer.host;
  const entry = config.src;

  const bs = browserSync.init({
    port,
    open: config.devServer.open,
    notify: false,
    online: true,
    logLevel: 'silent',
    ui: false,
    watch: true,
    injectChanges: true,
    server: {
      baseDir: serverRoot,
      directory: config.devServer.directory,
      serveStaticOptions: {
        redirect: true
      }
    },
    middleware: bSync.middlewareList({
      host,
      port,
      entry,
      serverRoot,
      cwd: config.cwd,
      src: config.src
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

  watch(config, bs.reload, {
    customLog: yellow(`Serving at ${host}:${port}`)
  });
}

async function lint(config) {
  debuglog('linting source code');
  debuglog('auto fix linting', config.lint.fix);
  debuglog('linting cwd', config.cwd);

  const eslint = new ESLint({
    fix: config.lint.fix,
    cwd: config.cwd,
    overrideConfigFile: config.lint.esrc,
    useEslintrc: true
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

// ++++++++++++++++
// EXPORT
// ++++++++++++++++

export default {
  gen: c => withConfig(c, gen),
  watch: c => withConfig(c, watch),
  serve: c => withConfig(c, serve),
  lint: c => withConfig(c, lint)
};
