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
  genBuildId,
  loadUserEnv,
  CACHE,
  getHash,
  safeFun,
  isObj,
  JESSE_LOOP_DATA_TOKEN,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
} = require('./util');

// globals

const pagination = [];
let globalLocales = [];
const globalConfig = {
  cwd: '.',
  buildId: genBuildId(),
  build: {
    mode: JESSE_BUILD_MODE_LAZY,
    dry: false
  },
  site: {},
  locales: [],
  views: {
    engine: 'handlebars',
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

async function compileTemplate(file, data) {
  const filePath = vpath(file);
  const engine = cons[globalConfig.views.engine ?? 'handlebars'];

  try {
    return await engine(filePath.full, data);
  } catch (err) {
    throw err;
  }
}

async function compileDataAndPaths(file, outputNameParts, isOutAsDir, locals, pageIndex) {
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
      filenameFromData = dynName.place(accessProperty(locals, dynName.localKey));
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

  if (isOutAsDir) {
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
    pages: pagination,
    jesse: {
      year: new Date().getFullYear(),
      urlPath: {
        short: path.parse(outPath).dir,
        full: outPath,
        here
      },
      page: {
        current: pageIndex,
        count: pagination.length
      }
    },
    site: {
      name: globalConfig.site.name,
      author: globalConfig.site.author
    },
    locales: globalConfig.locales
  });

  return {
    path: publicOutPath.concat(pageIndex > 1 ? String(pageIndex) : '', outPath),
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

async function build(page, index) {
  debugLog('working on templates');

  const viewsPath = vpath(globalConfig.views.path, true);
  const views = getDirPaths(viewsPath.full);

  async function transformView(viewPath) {
    const tmpl = vpath(viewPath); // a template view
    const file = viewsPath.concat(viewPath);
    const outName = globalConfig.output.filename[tmpl.name] || globalConfig.output.filename[path.join(tmpl.full)];

    const publicOutPath = vpath(globalConfig.output.path).full;
    const resultData = [];
    let genFilesCount = 0; // count all generated files

    const canProcess = viewPath && !tmpl.name.startsWith('.'); // can process if not a hidden file
    const outPath = outputName(outName ?? viewPath);

    const outputNameParts = outPath.name.split('/');

    if (canProcess && !outputNameParts[0].startsWith(JESSE_LOOP_DATA_TOKEN)) {
      const result = await compileDataAndPaths(file, outputNameParts, outPath.isDir, page, index);
      const validate = globalConfig.build.mode !== JESSE_BUILD_MODE_LAZY;

      try {
        if (validate) {
          handleCheersValidate(await cheers.validate(result.code),
            { gen: result.path, view: file });
        }

        writeFile(result.path, result.code, globalConfig.build.dry);
        resultData.push(result);
        genFilesCount++;
      } catch (err) {
        await del([publicOutPath]);
        throw err;
      }
    }

    if (canProcess && outputNameParts[0].startsWith(JESSE_LOOP_DATA_TOKEN) && Array.isArray(page)) {
      outputNameParts[0] = remTopChar(outputNameParts[0]);
      genFilesCount += page.length;
      page.forEach(async(dataItem, di) => {
        const result = await compileDataAndPaths(file, outputNameParts, outPath.isDir, dataItem, index);
        const validate = di === 0 && globalConfig.build.mode !== JESSE_BUILD_MODE_LAZY;

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
          throw err;
        }
      });
    }

    return { data: resultData, view: viewPath, count: genFilesCount };
  }

  const promises = views.map(transformView);
  return await Promise.all(promises);
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

function pageTransform(views, cacheBust) {
  return async item => {
    const index = item.page;
    const page = item.data;

    const cacheName = `page-${index}-manifest`;
    const markName = suffix => `page ${index} ${suffix}`;

    const markyStop = (label, count) => {
      const end = Math.floor(marky.stop(label).duration) / 1000;
      consola.info(label, count, 'files in', end, 's');
    };

    const genBuildHash = () => getHash(JSON.stringify([
      page,
      views.length,
      cacheBust
    ]));

    const buildStarter = arr => {
      const built = arr.reduce((acc, res) => {
        CACHE.set(cacheName, Buffer.from(JSON.stringify({
          data: res.data.concat(acc.data),
          count: res.count + acc.count,
          buildHash: genBuildHash()
        })));
        cheers.transform('html', res.data);
        return {
          data: res.data.concat(acc.data),
          count: res.count + acc.count
        };
      }, { data: [], count: 0 });

      return built;
    };

    CACHE.get(cacheName)
      .then(async found => {
        marky.mark(markName('from cache'));
        const res = JSON.parse(found.data.toString());
        const buildHash = genBuildHash();

        debugLog('Build hash', buildHash, 'Last build', res.buildHash);
        debugLog('Build hash == Cached build Hash', buildHash === res.buildHash);

        if (buildHash === res.buildHash) {
          cheers.transform('save', res.data);
          markyStop(markName('from cache'), res.count);
        } else {
          marky.mark(markName('transform'));
          const built = buildStarter(await build(page, index));
          markyStop(markName('transform'), built.count);
        }
      })
      .catch(async() => {
        marky.mark(markName('transform'));
        const built = buildStarter(await build(page, index));
        markyStop(markName('transform'), built.count);
      });
  };
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
async function funnel(dataSource) {
  if (!dataSource || typeof dataSource !== 'function') {
    throw (
      TypeError('jesse.funnel() takes a function. "dataSource" must be a function that returns locals')
    );
  }

  let funneledData = [];
  const fromDataSource = dataSource();
  const isPromise = typeof fromDataSource.then === 'function';

  if (isPromise) {
    funneledData = getValidData(await fromDataSource);
  }

  if (!isPromise) {
    funneledData = getValidData(fromDataSource);
  }

  if (Array.isArray(funneledData)) {
    while (funneledData.length >= 100) {
      pagination.push({
        page: pagination.length + 1,
        data: funneledData.splice(0, 50)
      });
    }
  }

  pagination.push({
    page: pagination.length + 1,
    data: funneledData
  });
}

/**
 * Compiles all templates according to configurations and outputs html.
 */
async function gen(opts = {}) {
  const { watching = '' } = opts;

  globalConfig.buildId = genBuildId();
  debugLog('generated a new build id', globalConfig.buildId);

  globalConfig.build.dry
  && consola.log('Dry run in', `"${globalConfig.build.mode}" mode`);

  setupLocales();

  // clean output dir
  const publicOutPath = vpath(globalConfig.output.path).full;
  const cleaned = await del([`${publicOutPath}/**`, `!${publicOutPath}`]);
  debugLog('cleaned output dir', cleaned);

  const assetsPath = vpath([globalConfig.cwd, 'assets'], true);
  const stylePath = vpath([globalConfig.cwd, 'style'], true);
  const scriptPath = vpath([globalConfig.cwd, 'script'], true);
  const viewsPath = vpath(globalConfig.views.path, true);

  const assets = getDirPaths(assetsPath.full, 'full');
  const styles = getDirPaths(stylePath.full, 'full');
  const script = getDirPaths(scriptPath.full, 'full');
  const views = getDirPaths(viewsPath.full, 'full');

  cheers.config({
    cwd: globalConfig.cwd,
    output: globalConfig.output,
    plugins: globalConfig.plugins,
    buildId: globalConfig.buildId,
    assets: globalConfig.assets,
    build: globalConfig.build,
    site: globalConfig.site
  });

  cheers.transform('assets', assets.map(p => ({ path: p })));
  cheers.transform('style', styles.map(p => ({ path: p })));
  cheers.transform('script', script.map(p => ({ path: p })));

  debugLog('Watching', `"${watching}"`);

  const cacheBust = ['', 'ready'].includes(watching)
    ? watching
    : fs.readFileSync(path.join(globalConfig.cwd, watching));

  const promises = pagination.map(pageTransform(views, cacheBust));
  await Promise.all(promises);
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
    `${watchPath.dir}/**/*.js`
  ], {
    cwd: globalConfig.cwd,
    ignored: ignore
  });

  watcher.on('ready', () => {
    consola.info('watching', watchPath.dir);
    gen({ watching: 'ready' });
    _cb();
  });

  const run = p => {
    debugLog('compiled', p);
    gen({ watching: p });
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
  const serverRoot = vpath(globalConfig.output.path, true).full;
  const bs = browserSync({
    port: port ?? 3000,
    open,
    server: {
      baseDir: serverRoot
    }
  });

  watch(bs.reload, watchIgnore);
}

module.exports = {
  watch,
  config,
  gen,
  funnel,
  serve,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
};
