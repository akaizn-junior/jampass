const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');
const browserSync = require('browser-sync');

const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;

const {
  accessProperty,
  concatObjects,
  getValidData,
  safeFilePath
} = require('./util');

const handleErrors = err => {
  consola.error(err);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
};

let funneledData = [];
process.on('uncaughtException', handleErrors);
process.on('unhandledRejection', handleErrors);

const globalConfig = {
  root: '.',
  input: {
    remote: false,
    templates: './views'
  },
  output: {
    remote: false,
    public: './public',
    tmp: './tmp'
  },
  engine: 'handlebars'
};

// Helpers

async function compileTemplate(file, data) {
  const filePath = safeFilePath(file);
  const engine = cons[globalConfig.engine ?? 'handlebars'];

  try {
    return await engine(filePath, data);
  } catch (err) {
    throw err;
  }
}

function writeHtmlFile(file, data) {
  const safeFile = safeFilePath(file);
  const safeFolderPath = path.join(globalConfig.cwd, globalConfig.output.public);

  const write = () => fs.writeFile(safeFile, data, {
    encoding: 'utf-8',
    flag: 'w'
  }, err => {
    if (err) throw err;
  });

  try {
    const stats = fs.statSync(safeFolderPath);
    if (!stats.isDirectory()) {
      throw Error('Public output must be a directory');
    } else {
      write();
    }
  } catch (err) {
    fs.mkdirSync(safeFolderPath, {
      recursive: true
    });
    write();
  }
}

// Interface

/**
 * Sets user configurations
 * @param {object} options User defined configurations
 */
function config(options = {}) {
  if (!options) throw Error('Options must be a valid object');

  globalConfig.cwd = options.cwd ?? globalConfig.cwd;
  globalConfig.engine = options.engine ?? globalConfig.engine;
  globalConfig.output = concatObjects(globalConfig.output, options.output ?? {});
  globalConfig.input = concatObjects(globalConfig.input, options.input ?? {});
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
 * Compiles all the templates according to configurations and outputs html.
 */
async function gen() {
  const safeFolderPath = path.join(globalConfig.cwd, globalConfig.input.templates);
  const files = await promisify(fs.readdir)(safeFolderPath);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const canUseFile = file && !file.startsWith('.'); // can use if defined and not hidden
    const name = path.parse(file).name;
    const fileOutPath = path.join(globalConfig.cwd, globalConfig.output.public);

    const outName = () => {
      if (name === 'index') return 'index';
      return globalConfig.output.filename[name];
    };

    const remTopChar = str => str.substring(1, fileOutName.length);
    const fileOutName = outName();

    const writeHtml = async(htmlName, data) => {
      const html = await compileTemplate(path.join(safeFolderPath, file), { data });
      let filenameFromData;

      if (htmlName.startsWith('%')) {
        filenameFromData = accessProperty(data, remTopChar(htmlName));
      }

      writeHtmlFile(path.format({
        dir: fileOutPath,
        name: filenameFromData || fileOutName,
        ext: '.html'
      }), html);
    };

    if (canUseFile && !fileOutName.startsWith('-')) {
      writeHtml(fileOutName, funneledData);
    }

    if (canUseFile && fileOutName.startsWith('-') && Array.isArray(funneledData)) {
      funneledData.forEach(dataItem => writeHtml(remTopChar(fileOutName), dataItem));
    }
  }
}

/**
 * Watches changes on the templates folder.
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {Function} cb Runs on triggered events
 */
function watch(cb = () => {}) {
  const templatesDir = path.join(globalConfig.cwd, globalConfig.input.templates);
  const watcher = chokidar.watch(templatesDir);
  const _cb = cb && typeof cb === 'function' ? cb : () => {};

  watcher.on('ready', () => {
    consola.info('Watching', templatesDir, 'for changes');
    gen();
    _cb();
  });

  watcher.on('change', p => {
    consola.info('compiled', p);
    gen();
    _cb();
  });
}

/**
 * Starts a development server.
 * Powered by [BrowserSync](https://browsersync.io/docs/api)
 */
function serve(port) {
  const serverRoot = path.join(globalConfig.cwd, globalConfig.output.public);
  const bs = browserSync({
    port: port ?? 3000,
    server: {
      baseDir: serverRoot
    }
  });

  watch(bs.reload);
}

module.exports = {
  watch,
  config,
  gen,
  funnel,
  serve
};