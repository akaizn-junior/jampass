import cons from 'consolidate';
import browserSync from 'browser-sync';
import chokidar from 'chokidar';
import del from 'del';
import { ESLint } from 'eslint';
import * as marky from 'marky';
import { bold, strikethrough } from 'colorette';

// node
import path from 'path';
import { Readable } from 'stream';

// local
import {
  validateAndUpdateHtml
} from './utils/parse.js';

import { LOCALS_LOOP_TOKEN } from './utils/tokens.js';
import { bundleSearchFeature, buildSearch } from './utils/search.js';
import { asyncRead, htmlsNamesGenerator } from './utils/stream.js';

import {
  vpath,
  getDirPaths,
  getSrcBase
} from './utils/path.js';
import {
  parseDynamicName,
  accessProperty,
  processWatchedAsset
} from './utils/process.js';
import {
  loadUserEnv,
  logger,
  debuglog,
  safeFun,
  fErrName,
  markyStop,
  tmpdir,
  handleThrown,
  toggleDebug,
  reduceViewsByChecksum
} from './utils/helpers.js';

import * as keep from './utils/keep.js';
import bSyncMiddleware from './utils/bs.middleware.js';
import defaultConfig from './default.config.js';

// quick setup

const userEnv = loadUserEnv();
debuglog(userEnv);

// ++++++++++++++++
// HELPERS
// ++++++++++++++++

async function compileView(config, file, locals) {
  const filePath = vpath(file);
  const name = config.views.engine.name ?? 'handlebars';
  const engineConfig = safeFun(config.views.engine.config);

  try {
    const engine = cons[name];
    // expose the template engine being internally used
    const templateEngine = await import(name);
    engineConfig(templateEngine);

    return await engine(filePath.full, locals);
  } catch (err) {
    err.name = fErrName(err.name, 'CompileView');
    throw err;
  }
}

async function funnel(config, file, funneled, flags = { onlyNames: false }) {
  debuglog('funnel data to', file);
  const parsed = parseDynamicName(vpath(file).base);

  const keysToPath = (locals, i) => parsed.keys?.reduce((acc, item) => {
    const index = Number(item.index || i);
    const data = locals[index] || locals;

    let prop = path.sep;
    if (item.key) prop = accessProperty(data, item.key);

    return vpath([acc, prop]).full;
  }, '');

  const withView = async(name, locals) => {
    if (flags.onlyNames) return;
    return compileView(config, name, locals);
  };

  const funnelData = async(locals, i) => {
    const prop = keysToPath(locals.data, i);
    const keysPath = parsed.place(prop);
    const dynamicView = vpath([config.cwd, config.src, parsed.name]).full;

    return {
      name: keysPath,
      html: await withView(dynamicView, {
        data: locals.data[i],
        locales: locals.locales
      })
    };
  };

  const htmls = [];
  const names = [];
  const isArray = Array.isArray(funneled.data);

  if (!parsed.loop && parsed.keys) {
    const res = await funnelData(funneled, 0);
    htmls.push(res.html);
    names.push(res.name);
  }

  if (parsed.loop && isArray) {
    const ps = funneled.data.map((_, i) =>
      funnelData(funneled, i)
    );

    const res = await Promise.all(ps);

    return {
      htmls: res.map(r => r.html),
      names: res.map(r => r.name)
    };
  }

  if (!parsed.keys) {
    names.push(parsed.name);
    htmls.push(
      await withView(file, funneled)
    );
  }

  return {
    htmls,
    names
  };
}

async function getLocales(config, files) {
  marky.mark('get locales');
  const dotjson = files['.json'] || [];
  const locales = dotjson.filter(file =>
    file.includes('/locales/')
    && file.endsWith('.json')
  );

  // const fromConfig = config.locales.map

  const localesProm = locales.map(async locale => {
    const url = new URL(locale, import.meta.url);

    const contents = JSON.parse(
      await asyncRead(url)
    );

    const name = vpath(locale).name;
    const [lang, region] = name.split('_');

    return {
      contents,
      locale: name,
      lang,
      region
    };
  });

  const fromFiles = await Promise.all(localesProm);
  const contents = fromFiles
    .reduce((acc, item) => Object.assign(acc, { [item.locale]: item.contents }), {});

  const res = {
    meta: fromFiles,
    ...contents
  };

  markyStop('get locales', {
    log(end) {
      logger.success('read', fromFiles.length, 'locales', `- ${end}s`);
    }
  });

  return res;
}

async function parseViews(config, views, funneled) {
  debuglog('parsing src views');
  marky.mark('parsing views');

  const srcBase = getSrcBase(config);
  const outputPath = vpath([config.owd, config.output.path]);

  const _views = await Promise.all(
    await views.reduce(reduceViewsByChecksum(() => watch(config)), [])
  );

  debuglog('views count', _views.length);

  if (!config.watch) {
    const cleaned = await del(
      [`${outputPath.full}/**`, `!${outputPath.full}`]
    );
    debuglog('clean output', cleaned);
  }

  const loop = arr => arr.map(async view => {
    const viewPath = vpath(view.path);
    const checksum = view.checksum;

    const { htmls, names } = await funnel(config, viewPath.full, funneled);
    keep.upsert(viewPath.full, { checksum, isValidHtml: false });

    const asyncGen = Readable.from(htmlsNamesGenerator(htmls, names));

    for await (const chunk of asyncGen) {
      const _ps = chunk.htmls.map(async(html, j) => validateAndUpdateHtml(config, {
        html,
        name: chunk.names[j],
        srcBase,
        outputPath,
        count: htmls.length,
        viewPath: viewPath.full
      }));

      if (_ps.length) {
        debuglog('parsed and output', _ps.length);
        Promise.all(_ps);

        markyStop('parsing views', {
          label: viewPath.base,
          count: _ps.length
        });
      }
    }

    return checksum;
  });

  // separate costly operations
  // by splitting views that generate multiple pages and single pages
  const isMultiple = s => s.startsWith(LOCALS_LOOP_TOKEN);
  const isSingle = s => !s.startsWith(LOCALS_LOOP_TOKEN);

  const single = _views.filter(v => isSingle(vpath(v.path).name));
  const multiple = _views.filter(v => isMultiple(vpath(v.path).name));

  debuglog('single page view', single.length);
  debuglog('multiple pages view', multiple.length);

  // independly resolve all pages
  Promise.all(loop(single));
  Promise.all(loop(multiple));

  return _views;
}

async function getFunneled(config, cacheBust = '') {
  // if no config.funnel
  const dataPath = vpath([config.cwd, config.src, defaultConfig.funnelName], true).full;
  const cb = cacheBust || '';
  const url = `${dataPath}?bust=${cb}`;

  debuglog('funnel data path', dataPath);
  debuglog('funneled data cache bust', cacheBust);
  debuglog('funneled data url', url);

  try {
    const imported = await import(url);
    const funneled = 'default' in imported ? imported.default : imported;

    if (funneled) {
      const funKeys = Array.isArray(funneled.data)
        ? Object.keys(funneled.data[0])
        : Object.keys(funneled.data || {});

      if (!funneled.data) funneled.data = [];
      debuglog('preview funneled data', funKeys);

      return funneled;
    }

    throw new Error(`invalid funneled data ${bold(funneled)}`);
  } catch (err) {
    err.name = 'DataFunnelError';
    err.message = dataPath.concat('\n\n', err.message);
    throw err;
  }
}

async function readSource(src) {
  const files = await getDirPaths(src, 'full');
  debuglog('source data', files);

  const classified = files.reduce((acc, file) => {
    const ext = vpath(file).ext;

    if (!acc[ext]) {
      acc[ext] = [file];
    } else {
      acc[ext].push(file);
    }

    return acc;
  }, {});

  debuglog('files classified by extension', classified);
  return classified;
}

async function unlinkFiles(config, toDel) {
  marky.mark('deleting files');

  const delp = vpath(toDel);
  const funneled = await getFunneled(config);
  const { names } = await funnel(config, delp.full, funneled, {
    onlyNames: true
  });

  const srcBase = getSrcBase(config, false);
  const fnms = names.map(nm => vpath([
    config.owd,
    config.output.path,
    srcBase,
    nm
  ]).full);

  try {
    const deld = await del(fnms, { force: true });
    deld.length && markyStop('deleting files', {
      label: strikethrough(delp.base),
      count: names.length
    });
  } catch (err) {
    throw err;
  }
}

// +++++++++++++++++++++++++++++++
// RUN WITH CONFIG
// +++++++++++++++++++++++++++++++

function withConfig(config, done) {
  process.on('uncaughtException', handleThrown(config));
  process.on('unhandledRejection', handleThrown(config));

  toggleDebug(config.build.debug);
  debuglog('user config %O', config);

  config.watch = ['watch', 'serve'].includes(done.name);

  // output working directory
  config.owd = config.cwd;
  if (config.watch) {
    const nm = 'tmpout';
    config.owd = tmpdir;
    config.output.path = nm;
  }

  config.env = process.env.NODE_ENV;
  config.isDev = config.env !== 'production';

  debuglog('user environment "%s"', config.env);
  debuglog('watch mode', config.watch);
  debuglog('output working directory', config.owd);
  debuglog('public output directory', config.output.path);

  if (done.name === 'watch') {
    const outputPath = vpath([config.owd, config.output.path]).full;
    del(outputPath, { force: true })
      .then(cleaned => {
        debuglog('init! cleaned output', cleaned);
      });
  }

  return done(config);
}

// ++++++++++++++++
// INTERFACE
// ++++++++++++++++

async function gen(config, watching = null, ext) {
  const funCacheBust = config.watchFunnel ? Date.now() : null;
  let funneled;

  if (!funCacheBust) {
    funneled = await getFunneled(config, funCacheBust);
  }

  const srcPath = vpath([config.cwd, config.src]);
  const read = await readSource(srcPath.full);
  // files read from source or currently being watched
  const files = watching || read;
  const views = config.watchFunnel ? read['.html'] : files['.html'] || [];

  if (ext !== '.html' && !config.watchFunnel) {
    const asset = watching?.[ext] || [];
    processWatchedAsset(config, asset, ext);
  }

  !funneled.locales && (funneled.locales = await getLocales(config, read));

  buildSearch(config, funneled);
  bundleSearchFeature(config, 'src/search/index.js', 'search.min.js');

  try {
    const parsed = await parseViews(config, views, funneled);
    return parsed;
  } catch (e) {
    throw e;
  }
}

/**
 * Watches changes on the templates
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {object} config user configurations
 * @param {Function} cb Runs on triggered events
 */
async function watch(config, cb = () => {}) {
  const watchPath = vpath([config.cwd, config.src], true);
  const _cb = safeFun(cb);

  const watcher = chokidar.watch([
    `${watchPath.full}/**/*.html`,
    `${watchPath.full}/**/*.css`,
    `${watchPath.full}/**/*.js`,
    `${watchPath.full}/**/*.mjs`
  ], {
    cwd: config.cwd,
    ignored: []
  });

  watcher.on('ready', () => {
    logger.info('watching', watchPath.full);
    gen(config);
    _cb();
  });

  const run = p => {
    debuglog('altered', p);
    const ext = vpath(p).ext;
    // the path here excludes the cwd defined above
    // add it back for the full path
    const fp = vpath([config.cwd, p]).full;
    const watching = { [ext]: [fp] };
    const isFunnel = p.endsWith(defaultConfig.funnelName);
    config.watchFunnel = isFunnel && config.build.watchFunnel;

    gen(config, watching, ext)
      .then(res => {
        res.length && _cb();
      });
  };

  const unl = async p => {
    debuglog('deleting', p);
    const fp = vpath([config.cwd, p]).full;
    unlinkFiles(config, fp);
    _cb();
  };

  watcher
    .on('change', run)
    .on('addDir', run)
    .on('unlink', unl)
    // .on('unlinkDir', unlink)
    .on('error', err => {
      throw err;
    });
}

/**
 * Starts a development server.
 * Powered by [BrowserSync](https://browsersync.io/docs/api)
 */
async function serve(config) {
  const serverRoot = vpath([config.owd, config.output.path]).full;

  const fallbackPagePath = config.devServer.pages['404'];
  const port = config.devServer.port ?? 2000;
  const host = 'http://localhost';
  const entry = config.src;

  const bs = browserSync({
    port,
    open: config.devServer.open,
    notify: false,
    server: {
      baseDir: serverRoot,
      directory: config.devServer.directory
    },
    middleware: bSyncMiddleware({
      host, port, entry, serverRoot
    }),
    /**
   * @see https://browsersync.io/docs/options/#option-callbacks
   */
    callbacks: {
      ready(err, _bs) {
        if (err) throw err;

        _bs.addMiddleware('*', (_, res) => {
          res.writeHead(302, {
            location: fallbackPagePath
          });
          res.end('404! fallback');
        });
      }
    }
  });

  watch(config, bs.reload);
}

async function lint(config) {
  debuglog('linting source code');
  debuglog('auto fix linting', config.lint.fix);
  debuglog('linting cwd', config.cwd);

  const eslint = new ESLint({
    fix: config.lint.fix,
    cwd: config.cwd,
    overrideConfigFile: config.lint.esrc
  });

  try {
    const res = await eslint.lintFiles(config.src);
    // update linted files
    await ESLint.outputFixes(res);
    // format res for stdout
    const fmtr = await eslint.loadFormatter('stylish');
    const text = fmtr.format(res);
    text.length && logger.log(text);
  } catch (err) {
    throw err;
  }
}

export default {
  gen: c => withConfig(c, gen),
  watch: c => withConfig(c, watch),
  serve: c => withConfig(c, serve),
  lint: c => withConfig(c, lint)
};
