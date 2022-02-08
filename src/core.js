// vendors
import cons from 'consolidate';
import browserSync from 'browser-sync';
import chokidar from 'chokidar';
import del from 'del';
import { ESLint } from 'eslint';
import * as marky from 'marky';
import { bold, strikethrough } from 'colorette';

// node
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

// local
import {
  debuglog,
  logger,
  vpath,
  loadUserEnv,
  safeFun,
  getDirPaths,
  tmpdir,
  handleThrown,
  toggleDebug,
  createHash,
  parseDynamicName,
  accessProperty,
  pathDistance,
  fErrName,
  markyStop,
  splitPathCwd,
  getSrcBase
} from './util.js';
import {
  validateHtml,
  writeFile,
  parseHtmlLinked,
  processAsset,
  updatedHtmlLinkedCss,
  updatedHtmlLinkedJs,
  updateStyleTagCss,
  updateScriptTagJs,
  minifyHtml,
  processJs
} from './cheers.js';
import * as keep from './keep.js';
import bSyncMiddleware from './bs.middleware.js';
import defaultConfig from './default.config.js';

// quick setup

const userEnv = loadUserEnv();
debuglog(userEnv);

// ++++++++++++++++
// HELPERS
// ++++++++++++++++

const newReadable = data => {
  const rs = new Readable();
  rs.push(data);
  rs.push(null);
  return rs;
};

async function compileView(config, file, locals) {
  const filePath = vpath(file);
  const name = config.views.engine.name ?? 'handlebars';
  const engineConfig = safeFun(config.views.engine.config);

  try {
    const engine = cons[name];
    // expose the template engine being internally used
    const templateEngine = await import(name);
    engineConfig(templateEngine);

    locals.cache = true; // some engines support cache
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

async function parseLinkedAssets(config, assets) {
  const srcBase = getSrcBase(config, false);
  // and the h is for helper
  const h = list => {
    const ps = list.map(async item => {
      const ext = item.ext;
      const entry = item.href || item.src;
      const exists = keep.get(entry);

      if (!exists) {
        const file = item.assetPath;
        const outputPath = vpath([config.owd, config.output.path, srcBase, entry]).full;
        const out = await processAsset(ext, config, file, outputPath);

        if (out) {
          const passed = {
            from: entry,
            to: vpath(out.to).base,
            code: Buffer.from(out.code),
            out: out.to
          };

          return passed;
        } else {
          logger.error('failed processing asset');
        }
      }

      return exists;
    });

    return Promise.all(ps);
  };

  const res = {};

  for (const ext in assets) {
    if (assets[ext]) {
      // list of assets of a specific extension
      const list = assets[ext];
      const data = await h(list);
      res[ext] = data;
    }
  }

  return res;
}

async function getLocales(config, files) {
  const dotjson = files['.json'] || [];
  const locales = dotjson.filter(file =>
    file.includes('/locales/')
    && file.endsWith('.json')
  );

  // const fromConfig = config.locales.map

  const localesProm = locales.map(async locale => {
    const contents = JSON.parse(
      await fs.readFile(new URL(locale, import.meta.url))
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

  return res;
}

function writeAssets(assets) {
  // flatten all asset lists
  const flat = Object.values(assets)
    .reduce((acc, list) => acc.concat(list), []);

  flat.forEach(asset => {
    const exists = keep.get(asset.from);

    if (!exists || exists.out !== asset.out) {
      debuglog('generated asset', asset.out);
      writeFile(newReadable(asset.code), asset.out);
    }
  });
}

function rearrangeAssetPaths(html, assets) {
  for (const ext in assets) {
    const list = assets[ext];

    if (list) {
      assets[ext] = list.map(asset => {
        const res = pathDistance(html.out, asset.out);
        asset.to = res.distance;
        return asset;
      });
    }
  }

  return assets;
}

async function parseViews(config, views, funneled) {
  debuglog('parsing src views');
  marky.mark('parsing views');

  const srcBase = getSrcBase(config);
  const outputPath = vpath([config.owd, config.output.path]);

  const _views = await Promise.all(
    await views.reduce(async(acc, v) => {
      try {
        const exists = keep.get(v);
        const code = await fs.readFile(v);
        const checksum = createHash(code, 64);

        // only allow views with new content
        if (checksum !== exists?.checksum) {
          (await acc).push({ path: v, checksum });
        }

        return acc;
      } catch (err) {
        if (err.code === 'ENOENT') {
          watch(config);
          return [];
        }
        throw err;
      }
    }, [])
  );

  debuglog('views count', _views.length);

  if (!config.watch) {
    const cleaned = await del(
      [`${outputPath.full}/**`, `!${outputPath.full}`]
    );
    debuglog('clean output', cleaned);
  }

  const ps = _views.map(async view => {
    const viewPath = vpath(view.path);
    const checksum = view.checksum;

    const { htmls, names } = await funnel(config, viewPath.full, funneled);
    keep.upsert(viewPath.full, { checksum });

    const _ps = htmls.map(async(html, j) => validateAndUpdateHtml(config, {
      html,
      name: names[j],
      srcBase,
      outputPath,
      count: htmls.length,
      viewPath: viewPath.full
    }));

    debuglog('parsed and output', _ps.length);

    Promise.all(_ps);

    markyStop('parsing views', {
      label: viewPath.base,
      count: _ps.length
    });

    return checksum;
  });

  return Promise.all(ps);
}

async function validateAndUpdateHtml(config, data) {
  const compiled = data.html;
  const outname = data.name;

  const tmpfile = vpath([tmpdir, data.srcBase, outname]).full;
  const htmlOutFile = data.outputPath.join(data.srcBase, outname).full;

  const html = {
    from: data.viewPath,
    out: htmlOutFile,
    code: compiled,
    tmpfile
  };

  try {
    validateHtml(config, html.code.toString(), {
      view: data.viewPath,
      out: html.out
    });

    // parse html and get linked assets
    const linked = parseHtmlLinked(config, html.code);
    // an object of schema { [ext]: [] } / ex: { '.css': [] }
    const assets = await parseLinkedAssets(config, linked);
    const reAssets = rearrangeAssetPaths(html, assets);

    writeAssets(reAssets);

    keep.appendHtmlTo(html.from, html.out, html);
    keep.appendAssetsTo(html.from, reAssets);

    return await updateAndWriteHtml(config, { html, assets: reAssets });
  } catch (err) {
    if (!config.watch) {
      const d = await del([data.outputPath.full], { force: true });
      debuglog('clean output', d);
    }
    throw err;
  }
}

async function updateAndWriteHtml(config, parsed) {
  const { html, assets } = parsed;

  try {
    // 'u' stands for 'updated'
    // these variables hold HTML with updated content
    const uLinkedCss = updatedHtmlLinkedCss(html.code, assets['.css']);
    const uLinkedJs = updatedHtmlLinkedJs(uLinkedCss, assets['.js']);

    const uStyleTags = await updateStyleTagCss(config, uLinkedJs, html.from);
    const uScriptTags = await updateScriptTagJs(uStyleTags);

    let minHtml = uScriptTags;

    if (!config.isDev) {
      await writeFile(newReadable(minHtml), html.tmpfile);
      minHtml = await minifyHtml(config, html.tmpfile);
    }

    await writeFile(newReadable(minHtml), html.out);
  } catch (err) {
    throw err;
  }
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

      return {
        funneled,
        funKeys
      };
    }

    throw new Error(`invalid funneled data ${bold(funneled)}`);
  } catch (err) {
    err.name = 'DataFunnelError';
    err.message = dataPath.concat('\n\n', err.message);
    throw err;
  }
}

async function parseAsset(config, asset, ext) {
  debuglog('parsing asset');
  const srcBase = getSrcBase(config);

  for (let i = 0; i < asset.length; i++) {
    const file = asset[i];
    const fileBase = splitPathCwd(config.cwd, file);
    const exists = keep.get(fileBase);

    // only parse asset if it exists
    // meaning it has already been parsed by reading it from an html file
    if (exists) {
      const outputPath = vpath([config.owd, config.output.path, srcBase, fileBase]).full;
      const processed = await processAsset(ext, config, file, outputPath);

      if (processed) {
        const res = {
          from: fileBase,
          to: vpath(processed.to).base,
          code: processed.code,
          out: processed.to
        };

        writeFile(newReadable(res.code), res.out);
        logger.info('processed asset', `"${fileBase}"`);
      } else {
        logger.error('failed processing asset');
      }
    }
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
  const { funneled } = await getFunneled(config);
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

function buildSearch(config, funneled) {
  const { indexes, indexKeyMaxSize } = config.build.search;

  const searchIndexes = indexes;
  if (!searchIndexes || !searchIndexes.length) return;

  const _indexKeyMaxSize = indexKeyMaxSize || 100;
  const data = funneled.data;
  const isArray = Array.isArray(data);
  let file = {};

  const getIndexes = locals => searchIndexes
    .reduce((acc, index) => {
      try {
        const value = accessProperty(locals, index);
        const isIndex = value.length <= _indexKeyMaxSize;

        if (isIndex) {
          acc[value] = {
            index,
            value: locals
          };
        }
      } catch (err) {
        logger.info('key "%s" is undefined.', index, 'Skipped index');
      }
      return acc;
    }, {});

  const fnm = 'indexes.json';
  const exists = keep.get(fnm);

  if (!exists || config.watchFunnel) {
    if (isArray) {
      file = data.reduce((acc, locals) => ({ ...acc, ...getIndexes(locals) }), {});
    } else {
      file = getIndexes(data);
    }

    const srcBase = getSrcBase(config, false);
    const out = nm => vpath([config.owd, config.output.path, srcBase, nm]).full;

    const dataStr = JSON.stringify(file, null, 2);
    writeFile(newReadable(dataStr), out(fnm));
    bundleSearchFeature(config, 'src/search/index.js', out('search.min.js'));
    logger.success('generated indexes "%s"', fnm);
    keep.upsert(fnm, file);
  }
}

async function bundleSearchFeature(config, file, out) {
  if (config.build.search?.lib) {
    const { to, code } = await processJs(config, file, out, {
      libName: 'Search',
      hash: false
    });

    const size = code.length;
    writeFile(newReadable(code), to);
    logger.success('bundled search "search.min.js"', '-', size, 'bytes');
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

  // output working directory
  config.owd = config.cwd;
  if (config.watch) {
    config.owd = tmpdir;
    config.output.path = 'tmpout';
  }

  config.env = process.env.NODE_ENV;
  config.isDev = config.env !== 'production';

  debuglog('user environment "%s"', config.env);
  debuglog('watch mode', config.watch);
  debuglog('output working directory', config.owd);
  debuglog('public output directory', config.output.path);

  return done(config);
}

// ++++++++++++++++
// INTERFACE
// ++++++++++++++++

async function gen(config, watching = null, ext) {
  const funCacheBust = config.watchFunnel ? Date.now() : null;
  const { funneled, funKeys } = await getFunneled(config, funCacheBust);

  debuglog('preview funneled data', funKeys);

  const srcPath = vpath([config.cwd, config.src]);
  const read = await readSource(srcPath.full);
  // files read from source or currently being watched
  const files = watching || read;
  const views = config.watchFunnel ? read['.html'] : files['.html'] || [];

  if (ext !== '.html' && !config.watchFunnel) {
    const asset = watching?.[ext] || [];
    parseAsset(config, asset, ext);
  }

  funneled.locales = await getLocales(config, read);

  buildSearch(config, funneled);
  const parsed = parseViews(config, views, funneled);
  return parsed;
}

/**
 * Watches changes on the templates
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {object} config user configurations
 * @param {Function} cb Runs on triggered events
 * @param {string[]} ignore paths/globs to ignore
 */
async function watch(config, cb = () => {}, ignore = []) {
  const watchPath = vpath([config.cwd, config.src], true);
  const _cb = safeFun(cb);

  const watcher = chokidar.watch([
    `${watchPath.full}/**/*.html`,
    `${watchPath.full}/**/*.css`,
    `${watchPath.full}/**/*.js`,
    `${watchPath.full}/**/*.mjs`
  ], {
    cwd: config.cwd,
    ignored: ignore
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
  const errorPagePath = config.devServer.pages['404'];
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
            location: errorPagePath
          });
          res.end('404');
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
  watch: c => {
    c.watch = true;
    return withConfig(c, watch);
  },
  serve: c => {
    c.watch = true;
    return withConfig(c, serve);
  },
  lint: c => withConfig(c, lint)
};
