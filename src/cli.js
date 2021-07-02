#!/usr/bin/env node

const yargs = require('yargs/yargs')(process.argv.slice(2));

const fs = require('fs');
const pkg = require('../package.json');
const jesse = require('./jesse');

let settings;

try {
  const configTool = `${process.cwd()}/.jesse.js`;
  const stats = fs.statSync(configTool);

  if (stats.isFile()) settings = require(configTool);
} catch (err) {
  throw err;
}

settings?.config && jesse.config(settings.config);
jesse.funnel(settings?.dataSource ?? (() => []));

yargs.scriptName('jesse');
yargs.version(pkg.version);

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: args => {
    if (Object.keys(args).length <= 2) {
      jesse.gen();
    }
  }
});

yargs.command({
  command: 'gen',
  description: 'Generate html from current configurations',
  handler: () => {
    jesse.gen();
  }
});

yargs.command({
  command: 'serve',
  description: 'Starts a development server and watches for changes. Pass a preferred port to use, default 3000',
  handler: args => {
    jesse.serve(args.port);
  }
});

yargs.command({
  command: 'watch',
  description: 'Watches for template changes',
  handler: () => {
    jesse.watch();
  }
});

yargs.showHelpOnFail(true, 'jesse');
yargs.argv;
