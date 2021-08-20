// deps

const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');
const browserSync = require('browser-sync');
const del = require('del');
const marky = require('marky');

// node
const fs = require('fs');
const path = require('path');
const http = require('http');

// local
const cheers = require('./cheers');

const {
  accessProperty,
  concatObjects,
  getValidData,
  outputName,
  getDirPaths,
  remTopChar,
  vpath,
  writeFile,
  handleErrors,
  debugLog,
  parseDynamicName,
  loadUserEnv,
  safeFun,
  JESSE_LOOP_DATA_TOKEN,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
} = require('./util');

// globals

const pagination = [];
let globalLocales = [];
let globalSearchList = [];
const globalConfig = {
  watchMode: false,
  cwd: '.',
  build: {
    mode: JESSE_BUILD_MODE_LAZY,
    dry: false,
    expose: false,
    timeout: 5,
    search: {}
  },
  site: {},
  locales: [],
  views: {
    engine: {
      name: 'handlebars',
      config: () => {}
    },
    remote: false,
    path: 'views'
  },
  output: {
    remote: false,
    path: 'public',
    filename: {}
  },
  plugins: {
    css: []
  },
  assets: {
    whitelist: []
  }
};

// Quick setup

loadUserEnv();

process.on('uncaughtException', err => handleErrors(err, globalConfig));
process.on('unhandledRejection', err => handleErrors(err, globalConfig));

// Helpers

const uxLocaleName = name => name.toLowerCase().replace(/-/g, '_');

function buildSearchIndex(locals, trigger) {
  const buildSearch = globalConfig.build.search;
  const searchKeys = Object.keys(globalConfig.build.search);

  if (searchKeys.length) {
    const searchIndex = searchKeys.reduce((acc, key) => {
      const value = buildSearch[key];
      if (value) {
        try {
          acc[key] = accessProperty(locals, value);
          return acc;
        } catch {
          return null;
        }
      }

      return null;
    }, {});

    if (searchIndex) globalSearchList.push(searchIndex);
    if (searchIndex && trigger) writeSearchFile(globalSearchList);
  }
}

function writeSearchFile(list) {
  const searchPath = path.join(globalConfig.output.path, 'search.json');
  writeFile(searchPath, JSON.stringify(list, null, 2));
}

async function compileTemplate(file, data) {
  const filePath = vpath(file);
  const name = globalConfig.views.engine.name ?? 'handlebars';
  const engineConfig = safeFun(globalConfig.views.engine.config);

  try {
    const engine = cons[name];
    // expose the template engine being internally used
    const templateEngine = require(name);
    engineConfig(templateEngine);

    return await engine(filePath.full, data);
  } catch (err) {
    if (globalConfig.watchMode) consola.info(err);
    else throw err;
  }
}

async function compileDataAndPaths(file, outputNameParts, locals, opts) {
  const { outAsDir, pages, currentPage, pagesLen } = opts;

  const publicOutPath = vpath(globalConfig.output.path);
  let filenameFromData;
  let localsUsed = locals;

  // no added output paths
  const dynName = parseDynamicName(outputNameParts[0]);
  if (outputNameParts.length === 1 && dynName.localKey) {
    if (Array.isArray(locals)) {
      localsUsed = locals[dynName.localIndex];
      filenameFromData = [
        dynName.place(accessProperty(localsUsed, dynName.localKey))
      ];
    } else {
      filenameFromData = [
        dynName.place(accessProperty(locals, dynName.localKey))
      ];
    }
  }

  if (Array.isArray(outputNameParts) && outputNameParts.length > 1) {
    filenameFromData = outputNameParts.map(name => {
      const dynamic = parseDynamicName(name);

      if (dynamic.localKey) {
        if (Array.isArray(locals)) {
          localsUsed = locals[dynName.localIndex];
          return dynamic.place(accessProperty(localsUsed, dynamic.localKey));
        }
        return dynamic.place(accessProperty(locals, dynamic.localKey));
      }

      return name;
    });
  }

  const processedPath = path.join(...filenameFromData || outputNameParts);
  const parsedOutPath = vpath(processedPath);

  let outPath = path.format({
    dir: parsedOutPath.dir,
    name: parsedOutPath.name,
    ext: '.html'
  });

  if (outAsDir) {
    outPath = path.format({
      dir: path.join(parsedOutPath.dir, parsedOutPath.base),
      name: 'index',
      ext: '.html'
    });
  }

  // locales will have an entry attribute
  // that should match the directory where locale specific pages are rendered to
  // try to get said entry from the output path here
  // to separate sub directory inside a locale directory
  const outParts = outPath.split('/');
  const possibleLocaleEntry = outParts[0];
  const locale = globalConfig.locales[uxLocaleName(possibleLocaleEntry)];
  let here = outPath;
  if (locale) here = outParts.splice(1, outParts.length).join('/');

  const html = await compileTemplate(file, {
    data: localsUsed,
    jesse: {
      year: new Date().getFullYear(),
      url: {
        dir: path.parse(outPath).dir,
        full: outPath,
        here,
        page: pages.current > 1 ? '/'.concat(pages.current) : ' ',
        locale: locale ? locale.lang : ' '
      },
      pages: {
        list: pagination.filter((item, i) => i && { page: item.page }),
        ...pages
      }
    },
    site: {
      name: globalConfig.site.name,
      author: globalConfig.site.author,
      url: globalConfig.site.url
    },
    locales: globalConfig.locales
  });

  buildSearchIndex(localsUsed, currentPage === pagesLen);

  return {
    path: publicOutPath.concat(pages.current > 1 ? String(pages.current) : '', outPath),
    code: html
  };
}

function handleCheersValidate(res, data) {
  if (!res.isValid) {
    consola.info('cheers.validate()', `"${data.gen}"`, `\ngenerated from "${data.view}"\n`);
  }

  res.errors.forEach(err => {
    consola.log(`${err.line}:${err.column}`, `"${err.ruleId}"`, 'error', err.message);
  });

  res.warnings.forEach(warn => {
    consola.log(`${warn.line}:${warn.column}`, `"${warn.ruleId}"`, 'error', warn.message);
  });

  if (!res.isValid) throw Error('HTML validation');
  return res.isValid;
}

async function build(page) {
  debugLog('working on templates');

  const viewsPath = vpath(globalConfig.views.path, true);
  const views = getDirPaths(viewsPath.full);
  const resultData = [];
  let genFilesCount = 0; // count all generated files

  for (let i = 0; i < views.length; i++) {
    const viewPath = views[i];
    const tmpl = vpath(viewPath); // a template view
    const file = viewsPath.concat(viewPath);
    const outName = globalConfig.output.filename[tmpl.name] || globalConfig.output.filename[path.join(tmpl.full)];

    const publicOutPath = vpath(globalConfig.output.path).full;

    const canProcess = viewPath && !tmpl.name.startsWith('.'); // can process if not a hidden file
    const outPath = outputName(outName ?? viewPath);

    const outputNameParts = outPath.name.split('/');

    if (canProcess && !outputNameParts[0].startsWith(JESSE_LOOP_DATA_TOKEN)) {
      const opts = {
        outAsDir: outPath.isDir,
        currentPage: 1,
        pagesLen: 1,
        pages: {
          current: page.page,
          previous: page.previous,
          next: page.next
        }
      };
      const result = await compileDataAndPaths(file, outputNameParts, page.data, opts);

      try {
        handleCheersValidate(await cheers.validate(result.code),
          { gen: result.path, view: file });

        writeFile(result.path, result.code, globalConfig.build.dry);
        resultData.push(result);
        genFilesCount++;
      } catch (err) {
        await del([publicOutPath]);
        if (globalConfig.watchMode) consola.info(err);
        else throw err;
      }
    }

    if (canProcess && outputNameParts[0].startsWith(JESSE_LOOP_DATA_TOKEN) && Array.isArray(page.list)) {
      outputNameParts[0] = remTopChar(outputNameParts[0]);
      genFilesCount += page.list.length;
      page.list.forEach(async(dataItem, di) => {
        const opts = {
          outAsDir: outPath.isDir,
          currentPage: di + 1,
          pagesLen: page.list.length,
          pages: {
            current: page.page,
            previous: page.previous,
            next: page.next
          }
        };
        const result = await compileDataAndPaths(file, outputNameParts, dataItem, opts);
        const validate = di === 0;

        try {
          if (validate) {
            handleCheersValidate(await cheers.validate(result.code),
              { gen: result.path, view: file });
          }

          writeFile(result.path, result.code, globalConfig.build.dry);

          if (!globalConfig.build.mode === JESSE_BUILD_MODE_LAZY) {
            di === 0 && resultData.push(result);
          } else {
            resultData.push(result);
          }
        } catch (err) {
          await del([publicOutPath]);
          if (globalConfig.watchMode) consola.info(err);
          else throw err;
        }
      });
    }
  }

  return { data: resultData, count: genFilesCount };
}

function setupLocales() {
  const locales = {};
  globalLocales.forEach(loc => {
    const locale = vpath([globalConfig.cwd, loc.json], true);
    const content = fs.readFileSync(locale.full);
    locales[uxLocaleName(loc.lang)] = {
      lang: loc.lang,
      entry: loc.entry,
      ...JSON.parse(content)
    };
  });

  globalConfig.locales = locales;
}

function pageTransform() {
  return async page => {
    const markName = suffix => `page ${page.page} ${suffix}`;

    const markyStop = (label, count) => {
      const end = Math.floor(marky.stop(label).duration) / 1000;
      consola.info(label, count, 'files in', end, 's');
    };

    marky.mark(markName('transform'));
    const res = await build(page);
    cheers.transform('html', res.data);
    markyStop(markName('transform'), res.count);
  };
}

function withPolling(fn) {
  const _fn = safeFun(fn);

  if (!pagination.length) {
    // poll for pagination data
    let ic = 0;
    const iid = setInterval(async() => {
      ic++;

      const safeTimeout = () => {
        // validate user input
        const ut = globalConfig.build.timeout;

        if (!ut || ut < 0 || ut >= 300) {
          throw Error('jesse withPolling(): timeout must be a positive value less than 300');
        }

        return ut;
      };

      const timeout = ic === safeTimeout();
      const success = pagination.length;

      if (timeout) {
        clearInterval(iid);
        consola.info('slow internet?');
        throw Error('jesse gen(): Connection timeout. Build failed, please try again.');
      }

      if (success) {
        clearInterval(iid);
        _fn();
      }
    }, 1000);
  } else {
    _fn();
  }
}

// Interface

/**
 * Sets user configurations
 * @param {object} options User defined configurations
 */
function config(options = {}, configCwd = '') {
  if (!options) throw Error('Options must be a valid object');

  // update paths
  globalConfig.cwd = options.cwd ?? (configCwd || globalConfig.cwd);

  // update using user configs
  globalConfig.output = concatObjects(globalConfig.output, options.output ?? {});
  globalConfig.views = concatObjects(globalConfig.views, options.views ?? {});
  globalConfig.views.path = path.join(globalConfig.cwd, globalConfig.views.path);
  globalConfig.output.path = path.join(configCwd, globalConfig.output.path);

  globalConfig.plugins = concatObjects(globalConfig.plugins, options.plugins ?? {});
  globalConfig.site = concatObjects(globalConfig.site, options.site ?? {});
  globalConfig.asssets = concatObjects(globalConfig.assets, options.assets ?? {});
  globalConfig.build = concatObjects(globalConfig.build, options.build ?? {});
  globalLocales = options.locales ?? [];

  const validMode = [JESSE_BUILD_MODE_LAZY, JESSE_BUILD_MODE_BUSY, JESSE_BUILD_MODE_STRICT]
    .includes(globalConfig.build.mode);
  if (!validMode) throw Error('build mode is not valid');
}

/**
 * Funnels data/locals through the generator.
 * @param {() => Array | Promise<Array>} dataSource The source of the data to inject.
 * It must return an array or an object.
 * @returns void
 */
function funnel(dataSource) {
  if (!dataSource || typeof dataSource !== 'function') {
    throw (
      TypeError('jesse.funnel() takes a function. "dataSource" must be a function that returns locals')
    );
  }

  const handleFunneledData = funneled => {
    if (!funneled.data) {
      throw Error('no data found');
    }

    const data = funneled.data;
    let every = 50;
    let maxNPages = Infinity;
    let pagesList = data;

    if (funneled.pages && funneled.pages.from) {
      pagesList = accessProperty(data, funneled.pages.from);
    }

    if (funneled.pages && funneled.pages.every) {
      every = funneled.pages.every;
    }

    if (funneled.pages && funneled.pages.max) {
      maxNPages = funneled.pages.max;
    }

    if (every < 10) consola.warn('Number of items per page is too low');

    if (pagesList && Array.isArray(pagesList)) {
      let i = 1;

      while (pagesList.length >= every && i < maxNPages) {
        const pages = pagesList.splice(0, every);
        const pagesLen = pagination.length;

        pagination.push({
          page: pagesLen + 1,
          previous: pagesLen > 1 ? pagesLen : null,
          next: pagesLen + 2,
          list: pages,
          data: pages
        });

        i++;
      }
    }

    const pagesLen = pagination.length;

    pagination.push({
      page: pagesLen + 1,
      previous: pagesLen > 1 ? pagesLen : null,
      next: pagesLen + 1,
      list: pagesList,
      data
    });

    if (globalConfig.build.expose) expose(JSON.stringify(data));
  };

  const fromDataSource = dataSource(data => {
    handleFunneledData(getValidData(data));
  });

  if (fromDataSource) {
    const isPromise = typeof fromDataSource.then === 'function';

    if (isPromise) {
      fromDataSource
        .then(res => {
          handleFunneledData(getValidData(res));
        })
        .catch(err => {
          throw err;
        });
    }

    if (!isPromise) {
      handleFunneledData(getValidData(fromDataSource));
    }
  }
}

/**
 * Compiles all templates according to configurations and outputs html.
 */
async function gen(opts = {}) {
  const { watching = '', ext, watchMode } = opts;

  globalConfig.watchMode = watchMode || false;

  globalConfig.build.dry
  && consola.log('Dry run in', `"${globalConfig.build.mode}" mode`);

  setupLocales(); // format locales as needed at this stage

  // build triggeres
  const triggerAll = ext === null || ext === '.html';
  const triggers = {
    all: triggerAll,
    js: triggerAll || ext === '.js' || ext === '.mjs',
    css: triggerAll || ext === '.css',
    html: triggerAll || ext === '.html'
  };

  triggers.html && (globalSearchList = []); // reset search list on every build

  // clean output dir
  const publicOutPath = vpath(globalConfig.output.path).full;
  const cleaned = triggers.all && await del([`${publicOutPath}/**`, `!${publicOutPath}`]);
  debugLog('cleaned output dir', cleaned);

  const assetsPath = triggers.all && vpath([globalConfig.cwd, 'assets']);
  const stylePath = triggers.css && vpath([globalConfig.cwd, 'style']);
  const scriptPath = triggers.js && vpath([globalConfig.cwd, 'script']);
  const staticPath = triggers.all && vpath([globalConfig.cwd, 'static']);

  const assets = triggers.all && getDirPaths(assetsPath.full, 'full');
  const styles = triggers.css && getDirPaths(stylePath.full, 'full');
  const script = triggers.js && getDirPaths(scriptPath.full, 'full');
  const staticAssets = triggers.all && getDirPaths(staticPath.full, 'full');

  cheers.config({
    watchMode: globalConfig.watchMode,
    cwd: globalConfig.cwd,
    output: globalConfig.output,
    plugins: globalConfig.plugins,
    assets: globalConfig.assets,
    build: globalConfig.build,
    site: globalConfig.site
  });

  const getProcState = p => {
    /* eslint-disable camelcase */
    const proc_all = 1;
    const proc_watched = 2;
    const proc_ignore = 3;

    return ['', 'ready'].includes(watching) || triggerAll
      ? proc_all
      : p.endsWith(watching) ? proc_watched
        : proc_ignore;
    /* eslint-enable camelcase */
  };

  triggers.all && cheers.transform('assets', assets.map(p => ({ path: p })));
  triggers.css && cheers.transform('style', styles.map(p => ({ path: p, procState: getProcState(p) })));
  triggers.js && cheers.transform('script', script.map(p => ({ path: p, procState: getProcState(p) })));
  triggers.all && cheers.transform('static', staticAssets.map(p => ({ path: p })));

  debugLog('Watching', `"${watching}"`);

  const run = () => {
    const promises = pagination.map(pageTransform());
    return Promise.all(promises);
  };

  triggers.html && await run();
}

/**
 * Watches changes on the templates folder.
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {Function} cb Runs on triggered events
 * @param {string[]} ignore paths/globs to ignore
 */
function watch(cb = () => {}, ignore = []) {
  const watchPath = vpath(globalConfig.views.path, true);
  const _cb = safeFun(cb);

  const watchMode = true;
  globalConfig.watchMode = watchMode;

  // sanity check
  // the directory to watch must be inside the project cwd
  // or at least be exactly the project cwd
  // otherwise fail
  const sanityCheck = watchPath.dir === globalConfig.cwd
    || watchPath.dir.startsWith(globalConfig.cwd);

  if (!sanityCheck) {
    throw Error('"views" path fail. Confirm "views" are in a subdirectory');
  }

  const watcher = chokidar.watch([
    `${watchPath.dir}/**/*.html`,
    `${watchPath.dir}/**/*.css`,
    `${watchPath.dir}/**/*.js`,
    `${watchPath.dir}/**/*.mjs`
  ], {
    cwd: globalConfig.cwd,
    ignored: ignore
  });

  watcher.on('ready', () => {
    consola.info('watching', watchPath.dir);
    withPolling(() => gen({ watching: 'ready', ext: null, watchMode }));
    _cb();
  });

  const run = p => {
    debugLog('compiled', p);
    withPolling(() => gen({ watching: p, ext: path.parse(p).ext, watchMode }));
    _cb();
  };

  watcher
    .on('change', run)
    .on('addDir', run)
    .on('unlink', run)
    .on('unlinkDir', run)
    .on('error', err => {
      throw err;
    });
}

/**
 * Starts a development server.
 * Powered by [BrowserSync](https://browsersync.io/docs/api)
 */
function serve({ port, open = false, watchIgnore }) {
  const serverRoot = vpath(globalConfig.output.path).full;
  const bs = browserSync({
    port: port ?? 3000,
    open,
    server: {
      baseDir: serverRoot
    },
    /**
     * @see https://browsersync.io/docs/options/#option-callbacks
     */
    callbacks: {
      /**
       * This 'ready' callback can be used
       * to access the Browsersync instance
       */
      ready(err, ins) {
        if (err) {
          if (globalConfig.watchMode) consola.info(err);
          else throw err;
        }

        ins.addMiddleware('*', (_, res) => {
          res.writeHead(302, {
            location: '/404.html'
          });
          res.end('Redirecting!');
        });
      }
    }
  });

  watch(bs.reload, watchIgnore);
}

function expose(data, opts = {}) {
  const { port, host, headers } = opts || {};
  const p = port || 5000;
  const h = host || '127.0.0.1';
  const _headers = headers || { 'Content-Type': 'application/json' };

  const server = http.createServer((_, res) => {
    res.writeHead(200, _headers);
    res.end(data);
  });

  server.listen(p, h, () => {
    consola.info(`Exposing data on port http://${h}:${p}`);
  });
}

module.exports = {
  watch,
  config,
  gen,
  funnel,
  serve,
  expose,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
};
