// vendors
import consola from 'consola';
import cons from 'consolidate';
import browserSync from 'browser-sync';
import chokidar from 'chokidar';
import del from 'del';
import { ESLint } from 'eslint';
import * as marky from 'marky';

// node
import fs from 'fs';
import path from 'path';

// local
import {
  log,
  vpath,
  loadUserEnv,
  safeFun,
  getDirPaths,
  tmpdir,
  handleThrown,
  toggleDebug,
  makeHash,
  parseDynamicName,
  accessProperty,
  pathDistance
} from './util.js';
import {
  validateHtml,
  writeFile,
  parseHtmlLinked,
  processAsset,
  updatedHtmlLinkedCss,
  updatedHtmlLinkedJs,
  updateStyleTagCss,
  updateScriptTagJs
  // minifyHtml
} from './cheers.js';
import * as keep from './keep.js';

// quick setup

const userEnv = loadUserEnv();
log(userEnv);

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
    throw err;
  }
}

async function funnel(config, file, funneled) {
  log('funnel data to', file);
  const parsed = parseDynamicName(vpath(file).base);
  const htmls = [];
  const names = [];

  const keysToPath = (locals, i) => parsed.keys?.reduce((acc, item) => {
    const index = Number(item.index || i);
    const data = locals[index] || locals;

    let prop = path.sep;
    if (item.key) prop = accessProperty(data, item.key);

    return vpath([acc, prop]).full;
  }, '');

  const funnelData = async(locals, i) => {
    const prop = keysToPath(locals.data, i);
    const keysPath = parsed.place(prop);
    const dynamicView = vpath([config.cwd, config.src, parsed.name]).full;

    names.push(keysPath);
    htmls.push(
      await compileView(config, dynamicView, {
        data: locals.data[i],
        locales: locals.locales
      })
    );
  };

  const isArray = Array.isArray(funneled.data);

  if (!parsed.loop && parsed.keys) {
    await funnelData(funneled, 0);
  }

  if (parsed.loop && isArray) {
    for (let i = 0; i < funneled.data.length; i++) {
      await funnelData(funneled, i);
    }
  }

  if (!parsed.keys) {
    names.push(parsed.name);
    htmls.push(
      await compileView(config, file, funneled)
    );
  }

  return {
    htmls,
    names
  };
}

function readSource(src) {
  log('reading source');

  const files = getDirPaths(src, 'full');
  log(files);

  log('classify files read by extension');

  const classified = files.reduce((acc, file) => {
    const ext = vpath(file).ext;

    if (!acc[ext]) {
      acc[ext] = [file];
    } else {
      acc[ext].push(file);
    }

    return acc;
  }, {});

  log(classified);
  return classified;
}

async function parseLinkedAssets(config, html, assets) {
  const srcBase = vpath([config.src]).base;

  // and the h is for helper
  const h = async list => {
    const result = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const entry = item.href || item.src;
      const exists = keep.get(entry);
      const ext = item.ext;

      if (!exists) {
        const file = item.assetPath;
        const outputPath = vpath([config.owd, config.output.path, srcBase, entry]).full;
        const out = await processAsset(ext, config, file, outputPath);

        if (out) {
          const passed = {
            html,
            from: entry,
            to: vpath(out.to).base,
            code: Buffer.from(out.code),
            out: out.to
          };

          result.push(passed);
        } else {
          consola.error('failed processing asset');
        }
      }
    }

    return result;
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

function getLocales(config, files) {
  const dotjson = files['.json'] || [];
  const locales = dotjson.filter(file =>
    file.includes('/locales/')
    && file.endsWith('.json')
  );

  // const fromConfig = config.locales.map

  const fromFiles = locales.map(locale => {
    const contents = JSON.parse(
      fs.readFileSync(new URL(locale, import.meta.url))
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

  const contents = fromFiles
    .reduce((acc, item) => Object.assign(acc, { [item.locale]: item.contents }), {});

  const res = {
    meta: fromFiles,
    ...contents
  };

  return res;
}

function writeAssets(config, assets) {
  assets.forEach(asset => {
    const passed = keep.get(asset.html);
    const item = passed?.[asset.from];

    if (!item || item.out !== asset.out) {
      log('generated asset', asset.out);
      writeFile(asset.out, asset.code);
    }
  });
}

function updateLinkedAssetsPaths(html, assets) {
  return assets.map(list => list.map(asset => {
    const res = pathDistance(html.out, asset.out);
    asset.to = res.distance;
    return asset;
  }));
}

async function parseViews(config, views, funneled) {
  log('parsing src views');
  marky.mark('parsing views');

  views = views.map(v => {
    const code = fs.readFileSync(v);
    // create content hash
    const hash = makeHash(code);
    return {
      path: v,
      hash
    };
  })
    .filter(v => {
      const item = keep.get(v.path);
      // only allow views with new content
      return v.hash !== item?.contentHash;
    });

  const result = [];
  const srcBase = vpath([config.cwd, config.src]).base;
  const outputPath = vpath([config.owd, config.output.path]);

  if (!config.watch) {
    const cleaned = await del(
      [`${outputPath.full}/**`, `!${outputPath.full}`]
    );
    log('clean output', cleaned);
  }

  for (let i = 0; i < views.length; i++) {
    const viewPath = views[i].path;
    const contentHash = views[i].hash;

    const { htmls, names } = await funnel(config, viewPath, funneled);

    const exists = keep.get(viewPath);
    keep.add(viewPath);

    let j = 0;
    while (j < htmls.length) {
      const compiled = htmls[j];
      const outname = names[j];

      const tmpfile = vpath([tmpdir, srcBase, outname]).full;
      const htmlOutFile = outputPath.join(srcBase, outname).full;

      const html = {
        from: viewPath,
        out: htmlOutFile,
        code: Buffer.from(compiled),
        tmpfile,
        contentHash
      };

      try {
        validateHtml(html.code.toString(), {
          view: viewPath,
          out: html.out
        });

        // parse html and get linked assets
        const linked = parseHtmlLinked(config, html.code);
        // an object of schema { [ext]: [] } / ex: { '.css': [] }
        let assets = await parseLinkedAssets(config, html.from, linked);

        // console.log('1', assets);

        const updatedValues = updateLinkedAssetsPaths(html, Object.values(assets));
        const assetList = updatedValues.reduce((acc, arr) => acc.concat(arr), []);

        console.log(assetList)

        writeAssets(config, assetList);

        // const updateAssetValues = ass => {
        //   let a = 0;
        //   for (const ext in ass) {
        //     if (ass[ext]) {
        //       ass[ext] = updatedValues[a];
        //       a++;
        //     }
        //   }

        //   return ass;
        // };

        // console.log('2', assets);

        // assets = updateAssetValues(assets);

        // console.log('3', assets);

        keep.appendHtmlTo(html.from, html.out, html);
        keep.appendAssetsTo(html.from, assets);

        result.push({
          ...assets,
          html
        });
      } catch (err) {
        const d = await del([outputPath.full], { force: true });
        log('clean output', d);
        throw err;
      }

      j++;
    }
  }

  return result;
}

async function prepareAndOutput(config, parsed) {
  const result = [];

  for (let i = 0; i < parsed.length; i++) {
    const { html, css, js } = parsed[i];

    try {
      // 'u' stands for 'updated'
      // these variables hold HTML with updated content
      const uLinkedCss = updatedHtmlLinkedCss(html.code, css);
      const uLinkedJs = updatedHtmlLinkedJs(uLinkedCss, js);
      const uStyleTags = await updateStyleTagCss(config, uLinkedJs);
      const uScriptTags = await updateScriptTagJs(uStyleTags);

      // writeFile(html.tmpfile, uScriptTags);
      // const minHtml = await minifyHtml(config, html.tmpfile);
      writeFile(html.out, uScriptTags);
      result.push(html.code);
    } catch (err) {
      throw err;
    }
  }

  const timer = marky.stop('parsing views');
  const end = Math.floor(timer.duration) / 1000;
  const no = result.length;
  const s = n => n === 1 ? '' : 's';
  consola.info('Generated', no, `file${s(no)} -`, `${end}s`);

  log('parsed and output', no, `file${s(no)}`);
  return result;
}

async function getFunneled(config) {
  const dataPath = vpath([config.cwd, config.src, config.funnel], true).full;
  log('funnel data path', dataPath);

  try {
    const imported = await import(dataPath);
    const funneled = imported.default || imported;
    return funneled;
  } catch (err) {
    throw err;
  }
}

async function parseAsset(config, asset, ext) {
  log('parsing asset');
  const srcBase = vpath([config.cwd, config.src]).base;

  for (let i = 0; i < asset.length; i++) {
    const file = asset[i];
    const fileBase = file.split(config.src + path.sep)[1];
    // being passed here means the asset is linked to an html file
    const passed = keep.get(fileBase);

    if (passed) {
      const outputPath = vpath([config.owd, config.output.path, srcBase, fileBase]).full;
      const processed = await processAsset(ext, config, file, outputPath);

      if (processed) {
        const res = {
          from: fileBase,
          to: vpath(processed.to).base,
          code: Buffer.from(processed.code),
          out: processed.to
        };

        writeFile(res.out, res.code);
        consola.info('processed asset', file);
      } else {
        consola.error('failed processing asset');
      }
    }
  }
}

// +++++++++++++++++++++++++++++++
// RUN WITH CONFIG
// +++++++++++++++++++++++++++++++

function withConfig(config, done) {
  process.on('uncaughtException', handleThrown(config));
  process.on('unhandledRejection', handleThrown(config));

  toggleDebug(config.debug);
  log('user config %O', config);

  // output working directory
  config.owd = config.cwd;
  if (config.watch) {
    config.owd = tmpdir;
    config.output.path = 'tmpout';
  }

  config.env = process.env.NODE_ENV;
  config.isDev = config.env !== 'production';

  log('working environment', config.env);
  log('watch mode', config.watch);
  log('output working directory', config.owd);
  log('public output directory', config.output.path);

  return done(config);
}

// ++++++++++++++++
// INTERFACE
// ++++++++++++++++

async function gen(config, watching = null, ext = null) {
  const funneled = await getFunneled(config);
  const funneledKeys = (() => {
    if (Array.isArray(funneled.data)) return Object.keys(funneled.data[0]);
    Object.keys(funneled.data);
  })();

  log('preview funneled data', funneledKeys);

  const srcPath = vpath([config.cwd, config.src]);
  const read = readSource(srcPath.full);
  // files read from source or currently being watched
  const files = watching || read;
  const views = files['.html'] || [];

  if (ext !== '.html') {
    const asset = watching?.[ext] || [];
    parseAsset(config, asset, ext);
  }

  funneled.locales = getLocales(config, read);
  const parsedViews = await parseViews(config, views, funneled);
  prepareAndOutput(config, parsedViews);
}

/**
 * Watches changes on the templates
 * Powered by [Chokidar](https://www.npmjs.com/package/chokidar)
 * @param {object} config user configurations
 * @param {Function} cb Runs on triggered events
 * @param {string[]} ignore paths/globs to ignore
 */
function watch(config, cb = () => {}, ignore = []) {
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
    consola.info('watching', watchPath.full);
    gen(config);
    _cb();
  });

  const run = () => p => {
    log('compiled', p);
    const ext = vpath(p).ext;

    // the path here excludes the cwd defined above
    // add it back for the full path
    const fp = vpath([config.cwd, p]).full;

    const watching = { [ext]: [fp] };
    gen(config, watching);
    _cb();
  };

  watcher
    .on('change', run('change'))
    .on('addDir', run('addDir'))
    .on('unlink', run('unlink'))
    .on('unlinkDir', run('unlinkDir'))
    .on('error', err => {
      throw err;
    });
}

/**
 * Starts a development server.
 * Powered by [BrowserSync](https://browsersync.io/docs/api)
 */
function serve(config) {
  const serverRoot = vpath([config.owd, config.output.path]).full;
  const errorPagePath = config.devServer.pages['404'];

  const bs = browserSync({
    port: config.port ?? 2000,
    open: config.open,
    server: {
      baseDir: serverRoot,
      directory: config.list
    },
    /**
     * @see https://browsersync.io/docs/options/#option-callbacks
     */
    callbacks: {
      /**
       * This 'ready' callback can be used
       * to access the Browsersync instance
       */
      ready(err, instance) {
        if (err) {
          throw err;
        }

        instance.addMiddleware('*', (_, res) => {
          res.writeHead(302, {
            location: errorPagePath
          });
          res.end('Redirecting!');
        });
      }
    }
  });

  watch(config, bs.reload);
}

async function lint(config) {
  log('linting source code');
  log('auto fix linting', config.fix);
  log('linting cwd', config.cwd);

  const eslint = new ESLint({
    fix: config.fix,
    cwd: config.cwd,
    overrideConfigFile: config.esrc
  });

  try {
    const res = await eslint.lintFiles(config.src);
    // update linted files
    await ESLint.outputFixes(res);
    // format res for stdout
    const fmtr = await eslint.loadFormatter('stylish');
    const text = fmtr.format(res);
    text.length && consola.log(text);
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
