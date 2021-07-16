// deps
const cheerio = require('cheerio');

// postcss and plugins
const postcss = require('postcss');
const postcssPresetEnv = require('postcss-preset-env');
const cssnano = require('cssnano');
const autoprefixer = require('autoprefixer');

// node
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// local
const {
  writeFile,
  concatObjects,
  vpath,
  concatLists,
  debugLog,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_STRICT
} = require('./util');

// globals
const globalConfig = {
  buildId: null,
  cwd: '.',
  build: {
    mode: JESSE_BUILD_MODE_LAZY,
    dry: false
  },
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
  },
  assets: {
    whitelist: []
  }
};

/**
 * A local store for processed items
 */
const keep = {};

const store = {
  new() {
    keep[globalConfig.buildId] = {};
  },
  clearOld() {
    Object.keys(keep).forEach(key => {
      if (key && keep[key] && key !== globalConfig.buildId) {
        delete keep[key];
      }
    });
  },
  get(key) {
    return keep[globalConfig.buildId][key];
  },
  set(k, v) {
    keep[globalConfig.buildId][k] = v;
  }
};

// process

/**
 * @param {string} elemId A unique identifier for the element process
 * @param {function} proc A callback to run as processing the element
 * @param {boolean} skipFlag Custom flag for skipping processing
 */
const processHelper = (elemId, proc, skipFlag = false) => {
  // process, if not already
  const buildKey = String(elemId);

  if (!store.get(buildKey) && !skipFlag) {
    proc(buildKey);
    store.set(buildKey, true);
  }
};

function css(element) {
  const cssSrc = element.attribs.href;
  processHelper(cssSrc, async() => {
    const cssPath = vpath([globalConfig.cwd, cssSrc]);
    const cssOutPath = path.join(globalConfig.output.path, cssSrc);
    const code = await promisify(fs.readFile)(cssPath.full);

    switch (cssPath.ext) {
    case '.css':
      postcss(globalConfig.plugins.css)
        .process(code, { from: cssPath.full, to: cssOutPath })
        .then(result => {
          writeFile(cssOutPath, result.css, globalConfig.build.dry);
        });
      break;
    }
  });
}

function image(element) {
  /**
   * @type String
   */
  const imgSrc = element.attribs.src;
  const ignoreDataUrls = imgSrc.startsWith('data:image');

  processHelper(Math.random(), async() => {
    const isExternal = imgSrc.substr(0, 10).includes('//');
    if (isExternal) {
      const source = imgSrc.split('://');
      const protocol = source[0];
      const provider = source[1].substring(0, source[1].indexOf('/'));

      if (protocol === 'http') {
        debugLog('site uses images served via', protocol);
        if (globalConfig.build.mode === JESSE_BUILD_MODE_STRICT) {
          throw Error('Image served via "http". Confirm external assets are from secure sources');
        }
      }

      if (!globalConfig.assets.whitelist.includes(provider)) {
        debugLog('site uses images from not whitelisted provider', provider);
        if (globalConfig.build.mode === JESSE_BUILD_MODE_STRICT) {
          throw Error(`Image served from an untrusted provider "${provider}". Provider may be whitelisted in settings`);
        }
      }
    } else {
      const imagePath = vpath([globalConfig.cwd, imgSrc], true);

      if (imagePath.stats.isFile()) {
        const data = await promisify(fs.readFile)(imagePath.full);
        writeFile(path.join(globalConfig.output.path, imgSrc), data, globalConfig.build.dry);
      }
    }
  }, ignoreDataUrls);
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
  globalConfig.build = concatObjects(globalConfig.build, options.build ?? {});

  globalConfig.plugins.css = concatLists(globalConfig.plugins, options.plugins, 'css');
  globalConfig.assets.whitelist = concatLists(globalConfig.assets, options.assets, 'whitelist');
}

/**
 * Transforms generated html
 */
function transform(data) {
  if (!data || !Array.isArray(data)) {
    throw (
      TypeError('cheers.transform() expects an array of (path: string, html?: string) objects')
    );
  }

  store.new();

  data.forEach(async file => {
    if (!file.path) {
      throw (
        TypeError('Object must have a valid "path" key')
      );
    }

    let html = file.html;
    if (!file.html) {
      html = await promisify(fs.readFile)(file.path);
    }

    const $ = cheerio.load(html);

    $('[rel=stylesheet]').toArray()
      .forEach(linkTag => css(linkTag));

    $('img[src]').toArray()
      .forEach(img => image(img));

    // write the new html back to src
    writeFile(file.path, html);
  });

  store.clearOld();
}

module.exports = {
  config,
  transform
};