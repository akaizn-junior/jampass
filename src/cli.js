#!/usr/bin/env node

const yargs = require('yargs/yargs')(process.argv.slice(2));

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const jesse = require('./jesse');

function loadUserSettings(otherPath = '') {
  let settings;
  const configPath = otherPath ?? 'jesse.config.js';

  try {
    const userConfig = path.join(process.cwd(), configPath);
    const stats = fs.statSync(userConfig);

    if (stats.isFile()) settings = require(userConfig);
  } catch (err) {
    throw err;
  }

  settings?.config && jesse.config(settings.config);
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

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: args => {
    if (Object.keys(args).length <= 2) {
      loadUserSettings(args.config);
      jesse.gen();
    }
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
    jesse.serve(args.port);
  }
});

yargs.command({
  command: 'watch',
  description: 'Watches for template changes',
  handler: args => {
    loadUserSettings(args.config);
    jesse.watch();
  }
});

yargs.showHelpOnFail(true, 'Generates a static site, simply');
yargs.argv;
