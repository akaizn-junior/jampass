#!/usr/bin/env node

// vendors
import { Command } from 'commander';
import { logger } from './util.js';

// node
import fs from 'fs';
import path from 'path';

// local
import core from './core.js';
import defaultConfig from './default.config.js';

// ++++++++++++++++++++++++
// Setup CLI
// ++++++++++++++++++++++++

const cli = new Command();
cli.name(defaultConfig.name);
cli.description('A static web builder');
cli.version(defaultConfig.version, '-v, --version', 'output the version number');
cli.showSuggestionAfterError(true);
cli.showHelpAfterError(true);
cli.exitOverride(); // throw on parsing error

// ++++++++++++++++++++++++
// Helpers
// ++++++++++++++++++++++++

function loadUserConfig(args) {
  const { opts, cmdOpts, cmd } = args;
  const _opts = Object.assign({}, cmdOpts, opts);

  let userOpts = defaultConfig.userOpts;
  const userSource = _opts.src || defaultConfig.userOpts.src;
  const configFile = _opts.config || defaultConfig.rcFileName;

  try {
    const userConfig = path.join(process.cwd(), userSource, configFile);
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      userOpts = require(userConfig);
      userOpts = Object.assign(userOpts, defaultConfig.userOpts);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // use command line opt if used
  // cli opts have priority over config file opts
  userOpts.cwd = _opts.cwd || userOpts.cwd;
  userOpts.src = _opts.src || userOpts.src;
  userOpts.funnel = _opts.funnel || userOpts.funnel;

  userOpts.build.debug = _opts.debug || userOpts.build.debug;
  userOpts.build.watchFunnel = _opts.watchFunnel || userOpts.build.watchFunnel;

  userOpts.views.path = _opts.views || userOpts.views.path;

  userOpts.output.path = _opts.dist || userOpts.output.path;
  userOpts.output.multi = _opts.multi || userOpts.output.multi;

  userOpts.devServer.port = _opts.port || userOpts.devServer.port;
  userOpts.devServer.directory = _opts.list || userOpts.devServer.directory;

  // all options and return
  const all = {
    ...userOpts,
    [cmd]: cmdOpts
  };

  return all;
}

const withConfig = (args, done) => {
  const conf = loadUserConfig({
    // global options
    opts: cli.opts(),
    // current command options
    cmdOpts: args.opts(),
    cmd: args.name()
  });

  return done(conf);
};

// ++++++++++++++++++++++++
// Global Options
// ++++++++++++++++++++++++

cli.option('-c, --config <path>', 'user config path');
cli.option('-s, --src <path>', 'reads the folder to build',
  defaultConfig.userOpts.src
);

cli.option('-C, --cwd <path>', 'define a custom cwd', defaultConfig.userOpts.cwd);
cli.option('-D, --debug', 'toggle debug logs', defaultConfig.userOpts.build.debug);
cli.option('-d, --dist <path>', 'output directory',
  defaultConfig.userOpts.output.path
);

cli.option('--multi', 'output multiple entries in public output', false);
cli.option('-f, --funnel <path>', 'funnel data path', defaultConfig.dataFile);
cli.option('--views <path>', 'source views path',
  defaultConfig.userOpts.views.path
);

// ++++++++++++++++++++++++
// Commands
// ++++++++++++++++++++++++

cli
  .command('gen', { isDefault: true })
  .description('build source')
  .action((_, d) => withConfig(d, c => core.gen(c)));

cli
  .command('serve')
  .description('serve static site')
  .option('-p, --port [number]', 'serve site on this port',
    defaultConfig.userOpts.devServer.port
  )
  .option('-o, --open', 'open default browser on serve',
    defaultConfig.userOpts.devServer.open
  )
  .option('--list', 'enable server directory listing',
    defaultConfig.userOpts.devServer.directory
  )
  .option('--pages-404', 'path to 404 page',
    defaultConfig.userOpts.devServer.pages[404]
  )
  .action((_, d) => withConfig(d, c => core.serve(c)));

cli
  .command('watch')
  .description('watch source edits')
  .option('--watch-funnel',
    'allow funnel changes to re-generate pages',
    defaultConfig.userOpts.build.watchFunnel
  )
  .action((_, d) => withConfig(d, c => core.watch(c)));

cli
  .command('lint')
  .description('lint source files')
  .option('--fix', 'auto fix linting errors', false)
  .option('--esrc <path>', 'eslint configuration file path', null)
  .action((_, d) => withConfig(d, c => core.lint(c)));

// ++++++++++++++++++++++++
// Parse CLI
// ++++++++++++++++++++++++

try {
  cli.parse(process.argv);
} catch (err) {
  logger.error(err);
  logger.log('Tchau.');
}
