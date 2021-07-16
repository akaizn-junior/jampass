#!/usr/bin/env node

// deps
const yargs = require('yargs/yargs')(process.argv.slice(2));

// node
const fs = require('fs');
const path = require('path');

// local
const pkg = require('../package.json');
const jesse = require('./core');
let validUserConfigPath = '';

function loadUserSettings(opts) {
  let settings;
  const configPath = opts.cpath ?? 'jesse.config.js';

  try {
    const userConfig = path.join(process.cwd(), configPath);
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      validUserConfigPath = userConfig;
      settings = require(userConfig);
      !settings.cwd && (settings.cwd = path.parse(userConfig).dir);
    }
  } catch (err) {
    throw err;
  }

  settings.build.dry = opts.dry;
  settings.build.mode = opts.mode;
  settings && jesse.config(settings);
}

yargs.scriptName('jesse');
yargs.version(pkg.version);

yargs.alias('help', 'h');
yargs.alias('version', 'v');

yargs.option('config', {
  alias: 'c',
  string: true,
  description: 'A path to user configuration'
});

yargs.option('port', {
  alias: 'p',
  string: true,
  description: 'a development server is launched from this port'
});

yargs.option('open', {
  alias: 'o',
  boolean: true,
  description: 'open your default browser on serve'
});

const withSettings = (args, done) => {
  loadUserSettings({
    cpath: args.config,
    mode: args.mode,
    dry: args.dryRun
  });

  return done();
};

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: args => withSettings(args, () => jesse.gen())
});

yargs.command({
  command: 'gen',
  description: 'Generate html from current configurations',
  handler: args => withSettings(args, () => jesse.gen())
});

yargs.command({
  command: 'serve',
  description: 'Starts a development server. Reads additional options. See help',
  handler: args => withSettings(args, () => {
    jesse.serve({
      port: args.port,
      open: args.open,
      watchIgnore: [validUserConfigPath]
    });
  })
});

yargs.command({
  command: 'watch',
  description: 'Watches for template changes',
  handler: args => withSettings(args, () => jesse.watch(null, [validUserConfigPath]))
});

yargs.showHelpOnFail(true, 'Generates a static site, simply');
yargs.argv;
