#!/usr/bin/env node

// vendors
import { Command } from 'commander';

// node
import fs from 'fs';

// local
import core from './core.js';

import * as config from './core.config.js';
import { vpath } from './util/path.js';

// ++++++++++++++++++++++++
// Setup CLI
// ++++++++++++++++++++++++

const cli = new Command();

cli.name(config.__name);
cli.description('A static web builder');
cli.version(config.__version, '-v, --version', 'output the version number');

cli.showSuggestionAfterError(true);
cli.showHelpAfterError(true);

// ++++++++++++++++++++++++
// Helpers
// ++++++++++++++++++++++++

async function loadUserConfig(args) {
  const { opts, cmdOpts, cmd } = args;
  const _opts = Object.assign({}, cmdOpts, opts);

  let uopts = config.userConfigSchema;
  const userCwd = _opts.cwd || uopts.cwd.default;
  const userSource = _opts.src || uopts.src.default;
  const configFileName = _opts.config || config.__jsRcName;

  try {
    const configFile = vpath([userCwd, userSource, configFileName]).full;
    const userConfig = configFile;
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      const _config = await import(userConfig);
      uopts = _config.default || _config;
      // concat user options with defaults
      uopts = Object.assign(config.userConfigSchema, uopts);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // use command line opt if used
  // cli opts have priority over config file opts
  uopts.env = _opts.env || 'development';

  uopts.cwd = _opts.cwd || uopts.cwd.default;
  uopts.src = _opts.src || uopts.src.default;
  uopts.funnel = _opts.funnel || config.__jsDataFile;

  uopts.build.debug = _opts.debug || uopts.build.default.debug;
  uopts.build.datawatch = _opts.datawatch || uopts.build.default.datawatch;

  uopts.views.path = _opts.views || uopts.views.default.path;

  uopts.output.path = _opts.dist || uopts.output.default.path;
  uopts.output.multi = _opts.multi || uopts.output.default.multi;

  uopts.devServer.port = _opts.port || uopts.devServer.default.port;
  uopts.devServer.directory = _opts.list || uopts.devServer.default.directory;

  // all options and return
  const all = {
    ...uopts,
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

const uschema = config.userConfigSchema;

cli.option('--env <env>', 'work environment');
cli.option('-c, --config <path>', 'user config path');
cli.option('-s, --src <path>', 'source folder', '.');

cli.option('-C, --cwd <path>', 'define a custom cwd', uschema.cwd.default);
cli.option('-D, --debug', 'toggle debug logs', uschema.build.default.debug);
cli.option('-d, --dist <path>', 'output directory',
  uschema.output.default.path
);

cli.option('--multi', 'output multiple entries in public output', false);
cli.option('-f, --funnel <path>', 'funnel data path', config.dataFile);
cli.option('--views <path>', 'source views path',
  uschema.views.default.path
);

cli.option('--datawatch',
  're-generate pages on data changes',
  uschema.build.default.datawatch
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
    uschema.devServer.default.port
  )
  .option('-o, --open', 'open default browser on serve',
    uschema.devServer.default.open
  )
  .option('--list', 'enable server directory listing',
    uschema.devServer.default.directory
  )
  .option('--pages-404', 'path to 404 page',
    uschema.devServer.default.pages[404]
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
