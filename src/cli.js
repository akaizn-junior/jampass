#!/usr/bin/env node

// deps
const yargs = require('yargs/yargs')(process.argv.slice(2));

// node
const fs = require('fs');
const path = require('path');

// local
const pkg = require('../package.json');
const jesse = require('./jesse');
let validUserConfigPath = '';

function loadUserSettings(otherPath = '') {
  let settings;
  const configPath = otherPath ?? 'jesse.config.js';

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
  description: 'A port to serve from. Default 3000'
});

yargs.option('open', {
  alias: 'o',
  boolean: true,
  description: 'open your default browser on serve'
});

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: args => {
    loadUserSettings(args.config);
    jesse.gen();
  }
});

yargs.command({
  command: 'gen',
  description: 'Generate html from current configurations',
  handler: args => {
    loadUserSettings(args.config);
    jesse.gen();
  }
});

yargs.command({
  command: 'serve',
  description: 'Starts a development server and watches for changes. Pass a preferred port to use, default 3000',
  handler: args => {
    loadUserSettings(args.config);
    jesse.serve({
      port: args.port,
      open: args.open,
      watchIgnore: [validUserConfigPath]
    });
  }
});

yargs.command({
  command: 'watch',
  description: 'Watches for template changes',
  handler: args => {
    loadUserSettings(args.config);
    jesse.watch(null, [validUserConfigPath]);
  }
});

yargs.showHelpOnFail(true, 'Generates a static site, simply');
yargs.argv;
