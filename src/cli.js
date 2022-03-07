#!/usr/bin/env node

// vendors
import { Command } from 'commander';

// node
import fs from 'fs';

// local
import core from './core.js';
import defaultConfig from './default.config.js';
import { vpath } from './utils/path.js';

// ++++++++++++++++++++++++
// Setup CLI
// ++++++++++++++++++++++++

const cli = new Command();
cli.name(defaultConfig.name);
cli.description('A static web builder');
cli.version(defaultConfig.version, '-v, --version', 'output the version number');

cli.showSuggestionAfterError(true);
cli.showHelpAfterError(true);

// ++++++++++++++++++++++++
// Helpers
// ++++++++++++++++++++++++

async function loadUserConfig(args) {
  const { opts, cmdOpts, cmd } = args;
  const _opts = Object.assign({}, cmdOpts, opts);

  let userOpts = defaultConfig.userOpts;
  const userCwd = _opts.cwd || defaultConfig.userOpts.cwd;
  const userSource = _opts.src || defaultConfig.userOpts.src;

  const configFileName = _opts.config || defaultConfig.rcFileName;
  const configFile = vpath([userCwd, userSource, configFileName]).full;

  try {
    const userConfig = configFile;
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      const _config = await import(userConfig);
      userOpts = _config.default || _config;
      // concat user options with defaults
      userOpts = Object.assign(defaultConfig.userOpts, userOpts);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // use command line opt if used
  // cli opts have priority over config file opts
  userOpts.env = _opts.env;

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

const withConfig = async(args, done) => {
  const conf = await loadUserConfig({
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

cli.option('--env <env>', 'work environment');
cli.option('-c, --config <path>', 'user config path');
cli.option('-s, --src <path>', 'source folder');

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

cli.option('--watch-funnel',
  're-generate pages on funnel changes',
  defaultConfig.userOpts.build.watchFunnel
);

// ++++++++++++++++++++++++
// Commands
// ++++++++++++++++++++++++

cli
  .command('gen', { isDefault: true })
  .description('build source')
  .action((_, d) => withConfig(d, c => {
    c.showCliHelp = cli.help.bind(cli);
    core.gen(c);
  }));

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
  .action((_, d) => withConfig(d, core.serve));

cli
  .command('watch')
  .description('watch source edits')
  .action((_, d) => withConfig(d, core.watch));

cli
  .command('lint')
  .description('lint source files')
  .option('--fix', 'auto fix linting errors', false)
  .option('--esrc <path>', 'eslint configuration file path', null)
  .action((_, d) => withConfig(d, core.lint));

// ++++++++++++++++++++++++
// Parse CLI
// ++++++++++++++++++++++++

cli.parse();
