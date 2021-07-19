// deps
const cheerio = require('cheerio');
const htmlValidator = require('html-validator');

// postcss and plugins
const postcss = require('postcss');
const postcssPresetEnv = require('postcss-preset-env');
const cssnano = require('cssnano');
const autoprefixer = require('autoprefixer');
const postCssHash = require('postcss-hash');

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
  genBuildId,
  JESSE_BUILD_MODE_LAZY,
  JESSE_BUILD_MODE_STRICT
} = require('./util');

// globals
const globalConfig = {
  buildId: genBuildId(),
  cwd: '.',
  build: {
    mode: JESSE_BUILD_MODE_LAZY,
    dry: false
  },
  site: {
    favicons: { src: '' }
  },
  output: {
    remote: false,
    path: 'public'
  },
  plugins: {
    css: [
      postcssPresetEnv(),
      cssnano(),
      autoprefixer(),
      postCssHash()
    ]
  },
  assets: {
    trust: []
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

function css(element, $) {
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
          const modLinkTag = $(element)
            .attr('href', result.opts.to);
          $(element).replaceWith(modLinkTag);

          writeFile(result.opts.to, result.css, globalConfig.build.dry);
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

      if (protocol === 'http' && !globalConfig.assets.trust.includes(provider)) {
        debugLog('site uses images served via "http" from', provider);
        if (globalConfig.build.mode === JESSE_BUILD_MODE_STRICT) {
          throw Error(`Image served via "http" from an untrusted provider "${provider}"`);
        }
      }
    } else {
      const imagePath = vpath([globalConfig.cwd, imgSrc], true);

      if (imagePath.stats.isFile()) {
        const data = await promisify(fs.readFile)(imagePath.full);
        const dest = path.join(globalConfig.output.path, imgSrc);
        writeFile(dest, data, globalConfig.build.dry);
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
  globalConfig.site = concatObjects(globalConfig.site, options.site ?? {});

  globalConfig.plugins.css = concatLists(globalConfig.plugins, options.plugins, 'css');
  globalConfig.assets.trust = concatLists(globalConfig.assets, options.assets, 'trust');
}

async function validate(html) {
  if (!html || typeof html !== 'string') {
    throw Error(`cheers.validate() takes a html string. "${html}" given`);
  }

  try {
    const result = await htmlValidator({
      data: html,
      format: 'text',
      validator: 'WHATWG'
    });

    return result;
  } catch (err) {
    throw err;
  }
}

function genFavicons() {
  // const favPath = vpath([globalConfig.cwd, globalConfig.site.favicons.src], true);
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

  genFavicons();

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
    $('[rel=stylesheet]').each((_, linkTag) => css(linkTag, $));
    $('img[src]').each((_, img) => image(img));

    // given the async nature of the code
    // save the final html after a few milliseconds
    const save = () => writeFile(file.path, $.html());
    setTimeout(save, 150);
  });

  store.clearOld();
}

module.exports = {
  config,
  transform,
  validate
};
