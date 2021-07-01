#!/usr/bin/env node

const yargs = require('yargs/yargs');

const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;

const jesse = require('./jesse');

module.exports = (function() {
  if (argv.watch) {
    jesse.watch();
  }

  if (argv.build) {
    jesse.build();
  }

  if (argv.serve) {
    jesse.serve();
  }
})();
