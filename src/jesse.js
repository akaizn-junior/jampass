const consola = require('consola');
const chokidar = require('chokidar');
const cons = require('consolidate');

const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;

const { accessProperty } = require('./util');

const handleErrors = err => {
  consola.error(err);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
};

class Jesse {
  constructor() {
    this.data = [];
    process.on('uncaughtException', handleErrors);
    process.on('unhandledRejection', handleErrors);

    this.configs = {
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
  }

  config(options = {}) {
    this.configs.root = options?.root ?? this.configs.root;
    this.configs.engine = options?.engine ?? this.configs.engine;
    this.configs.output = this.concatObjects(this.configs.output, options.output ?? {});
    this.configs.input = this.concatObjects(this.configs.input, options.input ?? {});
  }

  /**
   * Funnels data through the generator. It is irrelevant how the source is
   * implemented here, only the return value matters.
   * In this case it must always be an array.
   * @param {() => Array | Promise<Array>} dataSource The source of the data to inject
   */
  async funnel(dataSource) {
    if (typeof dataSource !== 'function') {
      throw (
        TypeError('DataSource must be a function that returns an Array or an Array Promise')
      );
    }

    const fromDataSource = dataSource();
    const isPromise = typeof fromDataSource.then === 'function';

    if (isPromise) {
      this.data = this.getDataArray(await fromDataSource);
    }

    if (!isPromise) {
      this.data = this.getDataArray(fromDataSource);
    }
  }

  getDataArray(arr) {
    if (!Array.isArray(arr)) throw TypeError('Data must be an array');
    return !this.data.length && Array.isArray(arr) ? arr : this.data;
  }

  safeFilePath(file) {
    const parsedPath = path.parse(file);
    const safeFilePath = path.join(parsedPath.dir, parsedPath.base);
    return safeFilePath;
  }

  concatObjects(target, src) {
    return Object.assign(target, src);
  }

  async compileTemplate(file, data) {
    const safeFilePath = this.safeFilePath(file);
    const engine = cons[this.configs.engine ?? 'swig'];

    try {
      return await engine(safeFilePath, data);
    } catch (err) {
      throw err;
    }
  }

  async build() {
    const safeFolderPath = path.join(this.configs.root, this.configs.input.templates);
    const files = await promisify(fs.readdir)(safeFolderPath);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // ignore hidden files
      if (file && !file.startsWith('.')) {
        this.data.forEach(async dataItem => {
          const html = await this.compileTemplate(path.join(safeFolderPath, file), dataItem);

          const filenameFromData = accessProperty(dataItem,
            this.configs.output.filename
          );

          this.writeHtmlFile(path.format({
            dir: path.join(this.configs.root, this.configs.output.public),
            name: filenameFromData || path.parse(file).name,
            ext: '.html'
          }), html);
        });
      }
    }
  }

  watch() {
    const templatesDir = path.join(this.configs.root, this.configs.input.templates);
    const watcher = chokidar.watch(templatesDir);

    watcher.on('ready', () => {
      consola.info('Watching', templatesDir, 'for changes');
      this.build();
    });

    watcher.on('change', p => {
      consola.info('compiled', p);
      this.build();
    });
  }

  writeHtmlFile(file, data) {
    const safeFile = this.safeFilePath(file);
    const safeFolderPath = path.join(this.configs.root, this.configs.output.public);

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
}

module.exports = Jesse;
