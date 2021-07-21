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
  CACHE,
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

function handleExternalUrls(src) {
  const source = src.split('//');
  const protocol = source[0];
  const provider = source[1].substring(0, source[1].indexOf('/'));

  if (protocol === 'http' && !globalConfig.assets.trust.includes(provider)) {
    debugLog('site uses images served via "http" from', provider);
    if (globalConfig.build.mode === JESSE_BUILD_MODE_STRICT) {
      throw Error(`Image served via "http" from an untrusted provider "${provider}"`);
    }
  }
}

function updateCssSrc(element, $) {
  const cssSrc = element.attribs.href;
  const isExternal = cssSrc.substr(0, 10).includes('//');
  const hasExtName = path.extname(cssSrc).startsWith('.');

  if (isExternal) handleExternalUrls(cssSrc);

  if (!isExternal && hasExtName) {
    const cssPath = vpath([globalConfig.cwd, cssSrc], true);
    const cached = CACHE.get(cssPath.full);

    cached
      .then(found => {
        const { path: p } = JSON.parse(found.data.toString());
        const base = p.split('style')[1];

        const out = path.join('style', base);
        const modded = $(element).attr('href', out);
        $(element).replaceWith(modded);
      }).catch(() => {});
  }
}

function updateImageSrc(element, $, attr = 'src') {
  const imgSrc = element.attribs.src || element.attribs.href;
  const isDataUrl = imgSrc.startsWith('data:image');
  const isExternal = imgSrc.substr(0, 10).includes('//');
  const hasExtName = path.extname(imgSrc).startsWith('.');

  if (isExternal) handleExternalUrls(imgSrc);

  if (!isExternal && !isDataUrl && hasExtName) {
    const imagePath = vpath([globalConfig.cwd, imgSrc], true);
    const cached = CACHE.get(imagePath.full);

    cached
      .then(found => {
        const { path: p } = JSON.parse(found.data.toString());
        const base = p.split('assets')[1];

        const out = path.join('assets', base);
        const modded = $(element).attr(attr, out);
        $(element).replaceWith(modded);
      })
      .catch(() => {});
  }
}

// helpers

async function handleCss(file) {
  const cssPath = vpath(file.path);
  const cached = CACHE.get(file.path);

  cached
    .then(found => {
      const { path: p, code } = JSON.parse(found.data.toString());
      writeFile(p, Buffer.from(code.data), globalConfig.build.dry);
    })
    .catch(() => {
      const fullPathBase = file.path.split('style')[1];
      const cssOutPath = path.join(globalConfig.output.path, 'style', fullPathBase);

      postcss(globalConfig.plugins.css)
        .process(file.code, { from: cssPath.full, to: cssOutPath })
        .then(result => {
          CACHE.set(file.path, Buffer.from(JSON.stringify({
            path: result.opts.to,
            code: result.css
          })));

          writeFile(result.opts.to, result.css, globalConfig.build.dry);
        });
    });
}

async function handleAssets(file) {
  const cached = CACHE.get(file.path);

  cached
    .then(found => {
      const { path: p, code } = JSON.parse(found.data.toString());
      writeFile(p, Buffer.from(code.data), globalConfig.build.dry);
    })
    .catch(() => {
      const fullPathBase = file.path.split('assets')[1];
      const dest = path.join(globalConfig.output.path, 'assets', fullPathBase);

      CACHE.set(file.path, Buffer.from(JSON.stringify({
        path: dest,
        code: Buffer.from(file.code)
      })));

      writeFile(dest, file.code, globalConfig.build.dry);
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

/**
 * Transforms static sources described by type
 * @param {string} type type of file to transform
 * @param {{path: string, code?: string}[]} data sources relevant data
 */
function transform(type, data) {
  if (!data || !Array.isArray(data)) {
    throw (
      TypeError('cheers.transform() expects an array of (path: string, html?: string) objects')
    );
  }

  data.forEach(async file => {
    if (!file.path) {
      throw (
        TypeError('Object must have a valid "path" key')
      );
    }

    let code = file.code;
    if (!file.code) {
      code = await promisify(fs.readFile)(file.path);
    }

    switch (type) {
    case 'save':
      writeFile(file.path, file.code);
      break;
    case 'html':
      const $ = cheerio.load(code);

      $('link[rel]').each((_, el) => {
        switch (el.attribs.rel) {
        case 'stylesheet': updateCssSrc(el, $); break;
        case 'preload':
          path.extname(el.attribs.href) === '.css' && updateCssSrc(el, $);
          path.extname(el.attribs.href) !== '.css' && updateImageSrc(el, $, 'href');
          break;
        }
      });

      $('img[src]').each((_, img) => updateImageSrc(img, $));

      const save = () => writeFile(file.path, $.html());
      setTimeout(save, 200);
      break;
    case 'style': handleCss({ path: file.path, code }); break;
    case 'assets': handleAssets({ path: file.path, code }); break;
    }
  });
}

module.exports = {
  config,
  transform,
  validate
};
