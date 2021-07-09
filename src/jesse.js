const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');
const browserSync = require('browser-sync');

const fs = require('fs');
const path = require('path');

const {
  accessProperty,
  concatObjects,
  getValidData,
  safeFilePath,
  outputName,
  getTemplatePaths
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
  const safeFolderPath = path.parse(safeFile).dir;

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
  } catch (error) {
    fs.mkdir(safeFolderPath, { recursive: true }, err => {
      if (err) throw err;
      write();
    });
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
  const files = getTemplatePaths(safeFolderPath);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const templateName = path.parse(file).name;

    const canProcess = file && !templateName.startsWith('.'); // can process if not hidden
    const publicOutPath = path.join(globalConfig.cwd, globalConfig.output.public);

    const fileOutPath = outputName(templateName, globalConfig.output.filename[templateName] ?? file);
    const fileOutName = fileOutPath.name.split('/');
    const isOutDir = fileOutPath.isDir;

    const remTopChar = str => str.substring(1, str.length);
    const writeHtml = async(htmlName, data) => {
      const html = await compileTemplate(path.join(safeFolderPath, file), { data });
      let filenameFromData;

      // no added output paths

      if (htmlName.length === 1 && htmlName[0].startsWith('%')) {
        if (Array.isArray(data)) filenameFromData = accessProperty(data[0], remTopChar(htmlName[0]));
        else filenameFromData = accessProperty(data, remTopChar(htmlName[0]));
      }

      if (Array.isArray(htmlName) && htmlName.length > 1) {
        filenameFromData = htmlName.map(nm => {
          const sIndex = nm.indexOf('%');

          if (sIndex !== -1) {
            const regularStr = nm.substring(0, sIndex);
            const dynamicStr = nm.substring(sIndex + 1, nm.length);

            if (Array.isArray(data)) return regularStr.concat(accessProperty(data[0], dynamicStr));
            return regularStr.concat(accessProperty(data, dynamicStr));
          }

          return nm;
        });
      }

      const processedOutputPath = path.join(...filenameFromData || htmlName);
      const parsedOutPath = path.parse(processedOutputPath);

      let outPath = path.format({
        dir: path.join(publicOutPath, parsedOutPath.dir),
        name: parsedOutPath.name,
        ext: '.html'
      });

      if (isOutDir) {
        outPath = path.format({
          dir: path.join(publicOutPath, parsedOutPath.dir, parsedOutPath.base),
          name: 'index',
          ext: '.html'
        });
      }

      writeHtmlFile(outPath, html);
    };

    if (canProcess && !fileOutName[0].startsWith('-')) {
      writeHtml(fileOutName, funneledData);
    }

    if (canProcess && fileOutName[0].startsWith('-') && Array.isArray(funneledData)) {
      fileOutName[0] = remTopChar(fileOutName[0]);
      funneledData.forEach(dataItem => writeHtml(fileOutName, dataItem));
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
