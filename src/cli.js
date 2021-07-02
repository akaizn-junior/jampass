#!/usr/bin/env node

const yargs = require('yargs/yargs')(process.argv.slice(2));

const fs = require('fs');
const jesse = require('./jesse');

let settings;

try {
  const config = `${process.cwd()}/.jesse.js`;
  const stats = fs.statSync(config);

  if (stats.isFile()) settings = require(config);
} catch (err) {
  throw err;
}

settings?.config && jesse.config(settings.config);
jesse.funnel(settings?.dataSource ?? (() => []));

yargs.scriptName('jesse');
yargs.version('0.0.1');

yargs.command({
  command: '$0',
  description: 'Generates a static site, simply',
  handler: () => {
    jesse.build();
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
  description: 'Starts a development server and watches for changes',
  handler: () => {
    jesse.serve();
  }
});

yargs.command({
  command: 'watch',
  description: 'Watches for template changes',
  handler: () => {
    jesse.watch();
  }
});

yargs.argv;
