#!/usr/bin/env node

// deps
const yargs = require('yargs/yargs')(process.argv.slice(2));

// node
const fs = require('fs');
const path = require('path');

// local
const pkg = require('../package.json');
const jampass = require('./core');
let validUserConfigPath = '';

function loadUserSettings(opts) {
  let settings;
  let configCwd;
  const configPath = opts.cpath ?? 'jampass.config.js';

  try {
    const userConfig = path.join(process.cwd(), configPath);
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) {
      validUserConfigPath = userConfig;
      settings = require(userConfig);
      configCwd = path.parse(userConfig).dir;
      !settings.cwd && (settings.cwd = configCwd);
    }
  } catch (err) {
    throw err;
  }

  settings.build = settings.build ?? {};
  opts.dry && (settings.build.dry = opts.dry);
  opts.mode && (settings.build.mode = opts.mode);
  opts.expose && (settings.build.expose = opts.expose);
  opts.timeout && (settings.build.timeout = opts.timeout);
  settings && jampass.config(settings, configCwd);
}

const withSettings = (args, done) => {
  loadUserSettings({
    cpath: args.config,
    mode: args.mode,
    dry: args.dryRun,
    expose: args.expose,
    timeout: args.timeout
  });

  return done();
};

yargs.scriptName('jampass');
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
  number: true,
  description: 'a development server is launched from this port'
});

yargs.option('open', {
  alias: 'o',
  boolean: true,
  description: 'open your default browser on serve'
});

yargs.option('expose', {
  alias: 'e',
  boolean: true,
  description: 'exposes funneled data via an impromptu server that will simply dump the data for debugging purposes'
});

yargs.option('timeout', {
  alias: 't',
  number: true,
  description: 'exposes funneled data via an impromptu server that will simply dump the data for debugging purposes'
});

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: args => withSettings(args, () => jampass.gen())
});

yargs.command({
  command: 'gen',
  description: 'Generate html from current configurations',
  handler: args => withSettings(args, () => jampass.gen())
});

yargs.command({
  command: 'serve',
  description: 'Starts a development server. Reads additional options. See help',
  handler: args => withSettings(args, () => {
    jampass.serve({
      port: args.port,
      open: args.open,
      watchIgnore: [validUserConfigPath]
    });
  })
});

yargs.command({
  command: 'watch',
  description: 'Watches for code changes',
  handler: args => withSettings(args, () => jampass.watch(null, [validUserConfigPath]))
});

yargs.showHelpOnFail(true, 'Generates a static site, simply');
yargs.argv;
