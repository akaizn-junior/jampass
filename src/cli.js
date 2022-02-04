#!/usr/bin/env node

// vendors
import { Command } from 'commander';
import { logger } from './util.js';

// node
import fs from 'fs';
import path from 'path';

// local
import core from './core.js';
import config from './default.config.js';

// ++++++++++++++++++++++++
// Setup CLI
// ++++++++++++++++++++++++

const cli = new Command();
cli.name(config.name);
cli.description('A static web builder');
cli.version(config.version, '-v, --version', 'output the version number');
cli.showSuggestionAfterError(true);
cli.showHelpAfterError(true);
cli.exitOverride(); // throw on parsing error

// ++++++++++++++++++++++++
// Helpers
// ++++++++++++++++++++++++

function loadUserConfig(args) {
  let userOpts = config.userOpts;
  const userSource = args.src || config.userOpts.src;
  const configFile = args.config || config.configFile;

  try {
    const userConfig = path.join(process.cwd(), userSource, configFile);
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      userOpts = require(userConfig);
      userOpts = Object.assign(userOpts, config.userOpts);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // use command line opt if used
  // cli opts have priority over config file opts
  userOpts.cwd = args.cwd || userOpts.cwd;
  userOpts.src = args.src || userOpts.src;
  userOpts.debug = args.debug || userOpts.debug;

  userOpts.funnel = args.funnel || userOpts.funnel;
  userOpts.watchFunnel = args.watchFunnel || userOpts.watchFunnel;

  userOpts.views.path = args.views || userOpts.views.path;

  userOpts.output.path = args.dist || userOpts.output.path;
  userOpts.output.multi = args.multi || userOpts.output.multi;

  userOpts.devServer.port = args.port || userOpts.devServer.port;
  userOpts.devServer.enableListing = args.list || userOpts.devServer.enableListing;

  // concatenate all args and return
  return Object.assign({}, args, userOpts);
}

const withConfig = (args, done) => {
  const conf = loadUserConfig(Object.assign(
    cli.opts(), // global options
    args.opts() // current command options
  ));

  return done(conf);
};

// ++++++++++++++++++++++++
// Global Options
// ++++++++++++++++++++++++

cli.option('-c, --config <path>', 'user config path', config.configFile);
cli.option('-s, --src <path>', 'reads the folder to build');
cli.option('-C, --cwd <path>', 'define a custom cwd');
cli.option('-D, --debug', 'toggle debug logs', false);
cli.option('-d, --dist <path>', 'output directory', config.userOpts.output.path);
cli.option('--multi', 'output multiple entries in public output', false);
cli.option('-f, --funnel <path>', 'funnel data path', config.dataFile);
cli.option('--views <path>', 'source views path', config.userOpts.views.path);

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
  .option('-p, --port [number]', 'serve site on this port', 2000)
  .option('-o, --open', 'open default browser on serve', false)
  .option('--list', 'enable server directory listing', false)
  .action((_, d) => withConfig(d, c => core.serve(c)));

cli
  .command('watch')
  .description('watch source edits')
  .option('--watch-funnel', 'allow funnel changes to re-generate pages', false)
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
  logger.log('Tchau.');
}
