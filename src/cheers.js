// deps
const cheerio = require('cheerio');
const postcss = require('postcss');
// postcss plugins
const postcssPresetEnv = require('postcss-preset-env');
const cssnano = require('cssnano');
const autoprefixer = require('autoprefixer');

// node
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// local
const { writeFile, concatObjects, vpath } = require('./util');

// globals
const globalConfig = {
  buildId: null,
  cwd: '.',
  output: {
    remote: false,
    path: 'public'
  },
  plugins: {
    css: [
      postcssPresetEnv(),
      cssnano(),
      autoprefixer()
    ]
  }
};

/**
 * A local store for processed items
 */
const keep = {};

// process

/**
 * @param {string} elemId A unique identifier for the element process
 * @param {function} proc A callback to run as processing the element
 */
const processHelper = (elemId, proc) => {
  // process, if not already
  const buildKey = elemId.concat('-', globalConfig.buildId);
  if (!keep[buildKey]) proc(elemId); keep[buildKey] = true;
};

function css(cssSrc) {
  processHelper(cssSrc, async() => {
    const cssPath = vpath([globalConfig.cwd, cssSrc]);
    const cssOutPath = path.join(globalConfig.output.path, cssSrc);
    const code = await promisify(fs.readFile)(cssPath.full);

    switch (cssPath.ext) {
    case '.css':
      postcss(globalConfig.plugins.css)
        .process(code, { from: cssPath.full, to: cssOutPath })
        .then(result => {
          writeFile(cssOutPath, result.css);
        });
      break;
    }
  });
}

// interface

/**
 * Sets user configurations
 * @param {object} options User defined configurations
 */
function config(options = {}) {
  if (!options) throw Error('Options must be a valid object');

  globalConfig.buildId = options.buildId ?? globalConfig.buildId;
  globalConfig.cwd = options.cwd ?? globalConfig.cwd;
  globalConfig.output = concatObjects(globalConfig.output, options.output ?? {});

  const concatPlugins = (a, b, key) => {
    if (b && b[key] && Array.isArray(b[key])) {
      return a[key].concat(b[key]);
    }
    return a[key];
  };

  globalConfig.plugins.css = concatPlugins(globalConfig.plugins, options.plugins, 'css');
}

/**
 * Transforms generated html
 */
function transform(data) {
  if (!data || !Array.isArray(data)) {
    throw (
      TypeError('Argument must be an array of (path: string, html?: string) objects')
    );
  }

  let i = 0;

  data.forEach(async file => {
    if (!file.path) {
      throw (
        TypeError('Object must have a valid "path" key')
      );
    }

    i++;
    console.log(i);

    let html = file.html;
    if (!file.html) {
      html = await promisify(fs.readFile)(file.path);
    }

    const $ = cheerio.load(html);

    $('[rel=stylesheet]').toArray()
      .forEach(linkTag => css(linkTag.attribs.href));
  });
}

module.exports = {
  config,
  transform
};
