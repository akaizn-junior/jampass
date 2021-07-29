// deps
const cheerio = require('cheerio');
const htmlValidator = require('html-validator');

// postcss and plugins
const postcss = require('postcss');
const postcssPresetEnv = require('postcss-preset-env');
const cssnano = require('cssnano');
const autoprefixer = require('autoprefixer');
// const postCssHash = require('postcss-hash');

// babel and plugins
const babel = require('@babel/core');

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
  getHash,
  safeFun,
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
      autoprefixer()
      // postCssHash()
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
    debugLog('site connects to unsecure service from', provider);
    if (globalConfig.build.mode === JESSE_BUILD_MODE_STRICT) {
      throw Error(`Content served via "http" from an untrusted provider "${provider}"`);
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

        const out = path.join('/style', base);
        const modded = $(element).attr('href', out);
        $(element).replaceWith(modded);
      }).catch(() => {});
  }
}

function updateImageSrc(element, $, attr = 'src') {
  const imgSrc = element.attribs.src ?? element.attribs.href;
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

        const out = path.join('/assets', base);
        const modded = $(element).attr(attr, out);
        $(element).replaceWith(modded);
      })
      .catch(() => {});
  }
}

function updateScriptSrc(element, $) {
  const scriptSrc = element.attribs.src;
  const isExternal = scriptSrc.substr(0, 10).includes('//');
  const hasExtName = path.extname(scriptSrc).startsWith('.');

  if (isExternal) handleExternalUrls(scriptSrc);

  if (!isExternal && hasExtName) {
    const scriptPath = vpath([globalConfig.cwd, scriptSrc], true);
    const cached = CACHE.get(scriptPath.full);

    cached
      .then(found => {
        const { path: p } = JSON.parse(found.data.toString());
        const base = p.split('script')[1];

        const out = path.join('/script', base);
        const modded = $(element).attr('src', out);
        $(element).replaceWith(modded);
      })
      .catch(() => {});
  }
}

// helpers

function processCss(code, src, out, cb) {
  postcss(globalConfig.plugins.css)
    .process(code, { from: src, to: out })
    .then(result => {
      safeFun(cb)(result);
    });
}

function processJs(code, filename, cb) {
  babel.transform(code, {
    envName: process.env.NODE_ENV ?? 'production',
    comments: false,
    compact: true,
    filename,
    minified: true,
    plugins: [],
    presets: [],
    sourceMaps: false,
    sourceType: 'unambiguous'
  }, (err, result) => {
    if (err) throw err;
    safeFun(cb)(result);
  });
}

async function handleCss(file, data) {
  const cached = CACHE.get(file.path);
  const code = Buffer.from(file.code);
  const genHash = () => getHash(code.toString().concat('+build hash', data.length));

  const re = () => {
    const fullPathBase = file.path.split('style')[1];
    const cssOutPath = path.join(globalConfig.output.path, 'style', fullPathBase);

    processCss(file.code, file.path, cssOutPath, result => {
      CACHE.set(file.path, Buffer.from(JSON.stringify({
        path: result.opts.to,
        code: result.css,
        buildHash: genHash()
      })));

      writeFile(result.opts.to, result.css, globalConfig.build.dry);
    });
  };

  cached
    .then(found => {
      const {
        path: p,
        code: cCode,
        buildHash: cHash
      } = JSON.parse(found.data.toString());

      const buildHash = genHash();
      const c = Buffer.from(cCode.data);

      debugLog('Build hash', buildHash, 'Last build', cHash);
      debugLog('Build hash == Cached build Hash', buildHash === cHash);

      if (buildHash === cHash) {
        writeFile(p, c, globalConfig.build.dry);
      } else {
        re();
      }
    })
    .catch(re);
}

function handleJs(file, data) {
  const cached = CACHE.get(file.path);
  const code = Buffer.from(file.code);

  const genHash = () => getHash(code.toString().concat('+build hash', data.length));

  const re = () => {
    const fullPathBase = file.path.split('script')[1];
    const dest = path.join(globalConfig.output.path, 'script', fullPathBase);

    processJs(code, file.path, result => {
      CACHE.set(file.path, Buffer.from(JSON.stringify({
        path: dest,
        code: result.code,
        buildHash: genHash()
      })));

      writeFile(dest, result.code, globalConfig.build.dry);
    });
  };

  cached
    .then(found => {
      const {
        path: p,
        code: cCode,
        buildHash: cHash
      } = JSON.parse(found.data.toString());

      const c = Buffer.from(cCode.data);
      const buildHash = genHash();

      debugLog('Build hash', buildHash, 'Last build', cHash);
      debugLog('Build hash == Cached build Hash', buildHash === cHash);

      if (buildHash === cHash) {
        writeFile(p, c, globalConfig.build.dry);
      } else {
        re();
      }
    })
    .catch(re);
}

async function handleAssets(file, data) {
  const cached = CACHE.get(file.path);

  const re = () => {
    const fullPathBase = file.path.split('assets')[1];
    const dest = path.join(globalConfig.output.path, 'assets', fullPathBase);
    const code = Buffer.from(file.code);
    const buildHash = getHash(code.toString().concat('+build hash', data.length));

    CACHE.set(file.path, Buffer.from(JSON.stringify({
      path: dest,
      code,
      buildHash
    })));

    writeFile(dest, file.code, globalConfig.build.dry);
  };

  cached
    .then(found => {
      const { path: p, code, buildHash: cachedHash } = JSON.parse(found.data.toString());
      const c = Buffer.from(code.data);
      const buildHash = getHash(c.toString().concat('+build hash', data.length));

      debugLog('Build hash', buildHash, 'Last build', cachedHash);
      debugLog('Build hash == Cached build Hash', buildHash === cachedHash);

      if (buildHash === cachedHash) {
        writeFile(p, c, globalConfig.build.dry);
      } else {
        re();
      }
    })
    .catch(re);
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
      TypeError(`cheers.transform() expects an array of (path: string, html?: string) objects. Received "${data}"`)
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
          switch (el.attribs.as) {
          case 'style': updateCssSrc(el, $); break;
          case 'image': updateImageSrc(el, $, 'href'); break;
          }
        }
      });

      $('img[src]').each((_, img) => updateImageSrc(img, $));

      const scriptsWithSrc = $('script[src]');
      scriptsWithSrc.each((_, el) => updateScriptSrc(el, $));

      const scripts = $('script');
      scripts.each((_, el) => {
        const scriptJs = $(el).html();
        processJs(scriptJs, file.path, result => $(el).html(result.code));
      });

      const styles = $('style');
      styles.each((_, el) => {
        const styleCss = $(el).html();
        processCss(styleCss, '', '', result => $(el).html(result.css));
      });

      const save = () => writeFile(file.path, $.html());
      save();
      break;
    case 'style': handleCss({ path: file.path, code }, data); break;
    case 'script': handleJs({ path: file.path, code }, data); break;
    case 'assets': handleAssets({ path: file.path, code }, data); break;
    }
  });
}

module.exports = {
  config,
  transform,
  validate
};
