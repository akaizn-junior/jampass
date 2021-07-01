const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');

const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;

const {
  accessProperty,
  concatObjects,
  getDataArray,
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

const defaultConfigs = {
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
  const engine = cons[defaultConfigs.engine ?? 'swig'];

  try {
    return await engine(filePath, data);
  } catch (err) {
    throw err;
  }
}

function writeHtmlFile(file, data) {
  const safeFile = safeFilePath(file);
  const safeFolderPath = path.join(defaultConfigs.root, defaultConfigs.output.public);

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

function config(options = {}) {
  if (!options) throw Error('Options must be a valid object');

  defaultConfigs.root = options.root ?? defaultConfigs.root;
  defaultConfigs.engine = options.engine ?? defaultConfigs.engine;
  defaultConfigs.output = concatObjects(defaultConfigs.output, options.output ?? {});
  defaultConfigs.input = concatObjects(defaultConfigs.input, options.input ?? {});
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
    funneledData = getDataArray(await fromDataSource);
  }

  if (!isPromise) {
    funneledData = getDataArray(fromDataSource);
  }
}

async function build() {
  const safeFolderPath = path.join(defaultConfigs.root, defaultConfigs.input.templates);
  const files = await promisify(fs.readdir)(safeFolderPath);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // ignore hidden files
    if (file && !file.startsWith('.')) {
      funneledData.forEach(async dataItem => {
        const html = await compileTemplate(path.join(safeFolderPath, file), dataItem);

        const filenameFromData = accessProperty(dataItem,
          defaultConfigs.output.filename
        );

        writeHtmlFile(path.format({
          dir: path.join(defaultConfigs.root, defaultConfigs.output.public),
          name: filenameFromData || path.parse(file).name,
          ext: '.html'
        }), html);
      });
    }
  }
}

function watch() {
  const templatesDir = path.join(defaultConfigs.root, defaultConfigs.input.templates);
  const watcher = chokidar.watch(templatesDir);

  watcher.on('ready', () => {
    consola.info('Watching', templatesDir, 'for changes');
    build();
  });

  watcher.on('change', p => {
    consola.info('compiled', p);
    build();
  });
}

function serve() { }

module.exports = {
  watch,
  config,
  build,
  funnel,
  serve
};
