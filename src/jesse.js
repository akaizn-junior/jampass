// deps

const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');
const browserSync = require('browser-sync');
const del = require('del');

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
  JESSE_LOOP_DATA_TOKEN
} = require('./util');

// globals

let funneledData = [];
const globalConfig = {
  cwd: '.',
  buildId: Date.now(),
  site: {},
  dirs: {
    assets: 'assets',
    style: 'style',
    static: 'static',
    script: 'script'
  },
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
  }
};

// Helpers

process.on('uncaughtException', err => handleErrors(err, globalConfig));
process.on('unhandledRejection', err => handleErrors(err, globalConfig));

async function compileTemplate(file, data) {
  const filePath = vpath(file);
  const engine = cons[globalConfig.engine ?? 'handlebars'];

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
    site: globalConfig.site
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
  globalConfig.buildId = Date.now();
  debugLog('generated a new build id', globalConfig.buildId);

  const safeFolderPath = vpath(globalConfig.views.path, true);
  const files = getDirPaths(safeFolderPath.full);
  const publicOutPath = vpath(globalConfig.output.path).full;

  const resultData = [];

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
      writeFile(result.path, result.html);
      resultData.push(result);
    }

    if (canProcess && outputNameArray[0].startsWith(JESSE_LOOP_DATA_TOKEN) && Array.isArray(funneledData)) {
      outputNameArray[0] = remTopChar(outputNameArray[0]);
      funneledData.forEach(async(dataItem, di) => {
        const result = await compile(file, outputNameArray, outPath.isDir, dataItem);
        writeFile(result.path, result.html);
        if (di === 0) resultData.push(result);
      });
    }
  }

  return resultData;
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
  Object.keys(globalConfig.dirs).forEach(key => {
    const value = globalConfig.dirs[key];
    if (value) {
      globalConfig.dirs[key] = path.join(globalConfig.cwd, value);
    }
  });

  // update using user configs
  globalConfig.engine = options.engine ?? globalConfig.engine;
  globalConfig.output = concatObjects(globalConfig.output, options.output ?? {});
  globalConfig.views = concatObjects(globalConfig.views, options.views ?? {});
  globalConfig.dirs = concatObjects(globalConfig.dirs, options.dirs ?? {});
  globalConfig.plugins = concatObjects(globalConfig.plugins, options.plugins ?? {});
  globalConfig.site = concatObjects(globalConfig.site, options.site ?? {});
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
  build()
    .then(data => {
      cheers.config({
        cwd: globalConfig.cwd,
        output: globalConfig.output,
        plugins: globalConfig.plugins,
        buildId: globalConfig.buildId
      });
      cheers.transform(data);
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
  serve
};
