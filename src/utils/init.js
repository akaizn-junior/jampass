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

export const loadUserEnv = () => dotenv.config({
  path: path.join(process.cwd(), '.env')
});

export const tmpdir = (() => {
  const dir = path.join(os.tmpdir(), defaultconfig.name);

  try {
    fs.statSync(dir);
  } catch (err) {
    // create if dir does not exist
    fs.mkdirSync(dir);
  }

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
  return err => {
    const end = () => {
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    };

    debuglog('error object keys', Object.keys(err));

    // special cases
    const special = [
      'CssSyntaxError',
      'HtmlValidatorError'
    ];

    const errname = err.name || err.code || '';

    if (!special.includes(errname)) {
      logger.error(errname, err);
    }

    if (!config.watch) {
      // clean output folder
      const outputPath = vpath([config.cwd, config.output.path]).full;
      del(outputPath)
        .then(cleaned => {
          debuglog('error! cleaned output', cleaned);
        });
      end();
    }
  };
}
