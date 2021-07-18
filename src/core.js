// deps

const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');
const browserSync = require('browser-sync');
const del = require('del');
const marky = require('marky');

// node
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
  handleCheersValidate,
  JESSE_LOOP_DATA_TOKEN,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_BUSY,
  JESSE_BUILD_MODE_STRICT
} = require('./util');

// globals

let funneledData = [];
const globalConfig = {
  cwd: '.',
  buildId: genBuildId(),
  build: {
    mode: JESSE_BUILD_MODE_LAZY,
    dry: false
  },
  site: {},
  views: {
    engine: 'handlebars',
    remote: false,
    path: 'views'
  },
  output: {
    remote: false,
    path: 'public'
  },
  plugins: {
    css: []
  },
  assets: {
    whitelist: []
  }
};

// Helpers

process.on('uncaughtException', err => handleErrors(err, globalConfig));
process.on('unhandledRejection', err => handleErrors(err, globalConfig));

async function compileTemplate(file, data) {
  const filePath = vpath(file);
  const engine = cons[globalConfig.views.engine ?? 'handlebars'];

  try {
    return await engine(filePath.full, data);
  } catch (err) {
    throw err;
  }
}

async function compile(file, outputNameArray, isOutDir, locals) {
  const publicOutPath = vpath(globalConfig.output.path);
  let filenameFromData;
  let localsUsed = locals;

  // no added output paths
  const dynName = parseDynamicName(outputNameArray[0]);
  if (outputNameArray.length === 1 && dynName.localKey) {
    if (Array.isArray(locals)) {
      localsUsed = locals[dynName.localIndex];
      filenameFromData = [
        dynName.place(accessProperty(localsUsed, dynName.localKey))
      ];
    } else {
      filenameFromData = dynName.place(accessProperty(locals, dynName.localKey));
    }
  }

  if (Array.isArray(outputNameArray) && outputNameArray.length > 1) {
    filenameFromData = outputNameArray.map(name => {
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

  // expose locals has "data" for all templates
  const html = await compileTemplate(file, {
    data: localsUsed,
    jesse: {
      year: new Date().getFullYear(),
      buildId: globalConfig.buildId
    },
    site: {
      name: globalConfig.site.name,
      author: globalConfig.site.author,
      description: globalConfig.site.description
    }
  });

  const processedPath = path.join(...filenameFromData || outputNameArray);
  const parsedOutPath = vpath(processedPath);

  let outPath = path.format({
    dir: publicOutPath.concat(parsedOutPath.dir),
    name: parsedOutPath.name,
    ext: '.html'
  });

  if (isOutDir) {
    outPath = path.format({
      dir: publicOutPath.concat(parsedOutPath.dir, parsedOutPath.base),
      name: 'index',
      ext: '.html'
    });
  }

  return { path: outPath, html };
}

async function build() {
  debugLog('working on templates');
  globalConfig.buildId = genBuildId();
  debugLog('generated a new build id', globalConfig.buildId);

  const safeFolderPath = vpath(globalConfig.views.path, true);
  const files = getDirPaths(safeFolderPath.full);
  const publicOutPath = vpath(globalConfig.output.path).full;

  const resultData = [];
  let filesGeneratedCount = 0;

  // clean output dir
  const cleaned = await del([`${publicOutPath}/**`, `!${publicOutPath}`]);
  debugLog('cleaned output dir', cleaned);

  for (let i = 0; i < files.length; i++) {
    const relativePath = files[i];
    const templateName = vpath(relativePath).name;
    const file = safeFolderPath.concat(relativePath);

    const canProcess = relativePath && !templateName.startsWith('.'); // can process if not hidden
    const outPath = outputName(globalConfig.output.filename[templateName] ?? relativePath);
    const outputNameArray = outPath.name.split('/');

    if (canProcess && !outputNameArray[0].startsWith(JESSE_LOOP_DATA_TOKEN)) {
      const result = await compile(file, outputNameArray, outPath.isDir, funneledData);
      const validate = globalConfig.build.mode !== JESSE_BUILD_MODE_LAZY;

      try {
        if (validate) {
          const validation = await cheers.validate(result.html);
          handleCheersValidate(validation, {
            gen: result.path,
            view: file
          });
        }

        writeFile(result.path, result.html, globalConfig.build.dry);
        resultData.push(result);
        filesGeneratedCount++;
      } catch (err) {
        throw err;
      }
    }

    if (canProcess && outputNameArray[0].startsWith(JESSE_LOOP_DATA_TOKEN) && Array.isArray(funneledData)) {
      outputNameArray[0] = remTopChar(outputNameArray[0]);
      filesGeneratedCount += funneledData.length;
      funneledData.forEach(async(dataItem, di) => {
        const result = await compile(file, outputNameArray, outPath.isDir, dataItem);
        const validate = di === 0 && globalConfig.build.mode !== JESSE_BUILD_MODE_LAZY;

        try {
          if (validate) {
            const validation = await cheers.validate(result.html);
            handleCheersValidate(validation, {
              gen: result.path,
              view: file
            });
          }

          writeFile(result.path, result.html, globalConfig.build.dry);

          if (!globalConfig.build.mode === JESSE_BUILD_MODE_LAZY) {
            di === 0 && resultData.push(result);
          } else {
            resultData.push(result);
          }
        } catch (err) {
          throw err;
        }
      });
    }
  }

  return { data: resultData, count: filesGeneratedCount };
}

// Interface

/**
 * Sets user configurations
 * @param {object} options User defined configurations
 */
function config(options = {}) {
  if (!options) throw Error('Options must be a valid object');

  // update paths
  globalConfig.cwd = options.cwd ?? globalConfig.cwd;
  globalConfig.views.path = path.join(globalConfig.cwd, globalConfig.views.path);
  globalConfig.output.path = path.join(globalConfig.cwd, globalConfig.output.path);

  // update using user configs
  globalConfig.output = concatObjects(globalConfig.output, options.output ?? {});
  globalConfig.views = concatObjects(globalConfig.views, options.views ?? {});
  globalConfig.plugins = concatObjects(globalConfig.plugins, options.plugins ?? {});
  globalConfig.site = concatObjects(globalConfig.site, options.site ?? {});
  globalConfig.asssets = concatObjects(globalConfig.assets, options.assets ?? {});
  globalConfig.build = concatObjects(globalConfig.build, options.build ?? {});

  switch (options.build.mode) {
  case JESSE_BUILD_MODE_BUSY: globalConfig.build.mode = JESSE_BUILD_MODE_BUSY; break;
  case JESSE_BUILD_MODE_STRICT: globalConfig.build.mode = JESSE_BUILD_MODE_STRICT; break;
  case JESSE_BUILD_MODE_LAZY:
  default: globalConfig.build.mode = JESSE_BUILD_MODE_LAZY; break;
  }
}

/**
 * Funnels data through the generator. It is irrelevant how the source is
 * implemented here, only the return value matters.
 * In this case it must always be an array.
 * @param {() => Array | Promise<Array>} dataSource The source of the data to inject
 */
async function funnel(dataSource) {
  if (!dataSource || typeof dataSource !== 'function') {
    throw (
      TypeError('DataSource must be a function that returns an Array or an Array Promise')
    );
  }

  const fromDataSource = dataSource();
  const isPromise = typeof fromDataSource.then === 'function';

  if (isPromise) {
    funneledData = getValidData(await fromDataSource);
  }

  if (!isPromise) {
    funneledData = getValidData(fromDataSource);
  }
}

/**
 * Compiles all templates according to configurations and outputs html.
 */
function gen() {
  globalConfig.build.dry
  && consola.log('Dry run in', `"${globalConfig.build.mode}" mode`);

  // start timer
  marky.mark('generating html');

  build()
    .then(res => {
      cheers.config({
        cwd: globalConfig.cwd,
        output: globalConfig.output,
        plugins: globalConfig.plugins,
        buildId: globalConfig.buildId,
        assets: globalConfig.assets,
        build: globalConfig.build
      });

      cheers.transform(res.data);
      const end = Math.floor(marky.stop('generating html').duration) / 1000;
      consola.info('generated', res.count, 'files in', end, 's');
    });
}

/**
 * Watches changes on the templates folder.
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {Function} cb Runs on triggered events
 * @param {string[]} ignore paths/globs to ignore
 */
function watch(cb = () => {}, ignore = []) {
  const watchPath = vpath(globalConfig.views.path, true);

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
  const _cb = cb && typeof cb === 'function' ? cb : () => {};

  watcher.on('ready', () => {
    consola.info('watching', watchPath.dir);
    gen();
    _cb();
  });

  watcher.on('change', p => {
    debugLog('compiled', p);
    gen();
    _cb();
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
