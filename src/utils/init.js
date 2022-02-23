import consola from 'consola';
import debug from 'debug';
import dotenv from 'dotenv';
import del from 'del';

// node
import fs from 'fs';
import os from 'os';
import path from 'path';

// local
import defaultconfig from '../default.config.js';
import { writeFile, newReadable } from './stream.js';
import { vpath } from './path.js';
import { safeFun } from './helpers.js';

export const exit = (code = 1) => {
  // eslint-disable-next-line no-process-exit
  process.exit(code);
};

export const loadUserEnv = () => dotenv.config({
  path: path.join(process.cwd(), '.env')
});

export const tmpdir = (() => {
  const dir = path.join(os.tmpdir(), defaultconfig.name);
  // others temp dirs
  const thtml = path.join(os.tmpdir(), defaultconfig.name, 'html');
  const tassets = path.join(os.tmpdir(), defaultconfig.name, 'assets');

  function attempt(d) {
    try {
      fs.statSync(d);
    } catch (err) {
      // create if dir does not exist
      fs.mkdirSync(d);
    }
  }

  attempt(dir);
  attempt(thtml);
  attempt(tassets);

  return dir;
})();

// consola instance
class HomeDirReporter extends consola.BasicReporter {
  constructor(options) {
    super(options);
    this.historyFile = defaultconfig.historyFilePath;
    this.lastFile = defaultconfig.lastCmdFilePath;
  }

  log(logObj, { stdout } = {}) {
    let line = this.formatLogObj(logObj, {
      width: stdout.columns || 0
    });

    line = ''.concat(Date.now(), ';', line, '\n');
    writeFile(newReadable(line), this.historyFile, null, 'a+');
    return;
  }
}

export const logger = consola.create({
  level: 4,
  throttle: 3,
  async: true,
  reporters: [
    new consola.FancyReporter()
  ]
});

export const history = consola.create({
  async: true,
  reporters: [
    new HomeDirReporter()
  ]
});

// bind debug log to consola info
debug.log = logger.log.bind(logger);
export const debuglog = debug(defaultconfig.name);

export function toggleDebug(toggle) {
  if (toggle) debug.enable(defaultconfig.name);
  else debug.disable();
}

export function handleThrown(config) {
  return async err => {
    debuglog('error object keys', Object.keys(err));

    const errname = err.name || err.code || '';
    const snippet = err.snippet;
    delete err.snippet;

    if (snippet) {
      logger.error(snippet);
    } else {
      logger.error(errname, err);
    }

    if (!config.watch) {
      // clean output folder
      const outputPath = vpath([config.cwd, config.output.path]).full;
      const cleaned = await del(outputPath, { force: true });
      debuglog('error! cleaned output', cleaned);
      exit();
    }
  };
}

export function isValidSource(config, cliHelp) {
  try {
    // no source provided, ok only if cwd has an 'index.html'
    if (!config.src) {
    // does cwd have an 'index.html' file
      vpath([config.cwd, 'index.html'], true);
    }
    return true;
  } catch (err) {
    logger.warn('Missing source. Set a source folder or add an "index.html" to the cwd');
    safeFun(cliHelp)();
  }
}
