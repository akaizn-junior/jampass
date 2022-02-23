import { HtmlValidate } from 'html-validate';
import cheerio from 'cheerio';
import del from 'del';
import tmp from 'tmp';
import { blue } from 'colorette';

// node
import { EOL } from 'os';

// local
import { vpath, splitPathCwd, pathDistance } from './path.js';
import { logger, debuglog } from './init.js';
import { genSnippet, minifyHtml } from './helpers.js';
import { writeFile, newReadable } from './stream.js';
import { processCss, processLinkedAssets } from './process.js';
import * as keep from './keep.js';
import defaultConfig from '../default.config.js';

const wrapCheerioElem = m => '\n'.concat(m, '\n');

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

export async function validateHtml(config, html, opts) {
  if (!html || typeof html !== 'string') {
    throw Error(`validateHtml() takes a html string. "${html}" given`);
  }

  try {
    const validate = new HtmlValidate({
      root: false,
      extends: ['html-validate:recommended']
    });

    const res = validate.validateString(html);

    const handleMsg = async msg => {
      const emsg = splitPathCwd(config.cwd, opts.view)
        .concat(':', msg.line, ':', msg.column);

      msg.name = 'HtmlValidatorError';
      msg.snippet = await genSnippet({
        code: html,
        line: msg.line,
        column: msg.column,
        title: `HtmlValidatorError ${emsg} "${msg.ruleId}" ${msg.message}`
      });

      throw msg;
    };

    res.results[0]?.messages.forEach(handleMsg);
    return res.valid;
  } catch (err) {
    throw err;
  }
}

export function parseHtmlLinked(config, code) {
  const $ = cheerio.load(code);

  const linked = {};
  const addLinked = (ext, data) => {
    if (!linked[ext]) {
      linked[ext] = [data];
    } else {
      linked[ext].push(data);
    }
  };

  const notFoundLog = (asset, isStatic = false) => {
    const exists = keep.get(`${asset}-404`);
    !exists && !isStatic && logger.log(blue('skipped'), `"${asset}" not found locally`);
  };

  $('link[rel]').each((_, el) => {
    try {
      const hrefPath = vpath(
        [config.cwd, config.src, el.attribs.href],
        true
      );

      const data = {
        ext: hrefPath.ext,
        assetPath: hrefPath.full,
        ...el.attribs
      };

      addLinked(hrefPath.ext, data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        err.name = 'HtmlLinkedCssWarn';

        const isStatic = el.attribs['data-static'] === 'true';
        notFoundLog(el.attribs.href, isStatic);
        keep.add(`${el.attribs.href}-404`, { skipped: true });
      }
    }
  });

  $('script[src]').each((_, el) => {
    try {
      const srcPath = vpath(
        [config.cwd, config.src, el.attribs.src],
        true
      );

      const data = {
        ext: srcPath.ext,
        assetPath: srcPath.full,
        ...el.attribs
      };

      addLinked(srcPath.ext, data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        err.name = 'HtmlLinkedScriptWarn';

        const isStatic = el.attribs['data-static'] === 'true';
        notFoundLog(el.attribs.src, isStatic);
        keep.add(`${el.attribs.src}-404`, { skipped: true });
      } else {
        throw err;
      }
    }
  });

  return linked;
}

export function updatedHtmlLinkedJs(code, linkedJs) {
  const $ = cheerio.load(code);
  linkedJs = linkedJs || [];

  for (let i = 0; i < linkedJs.length; i++) {
    const it = linkedJs[i];
    const el = $(`script[src="${it.from}"]`);

    const mod = el.attr('src', it.to);
    $(el).replaceWith(wrapCheerioElem(mod));
  }

  return $.html();
}

export function updatedHtmlLinkedCss(code, linkedCss) {
  const $ = cheerio.load(code);
  linkedCss = linkedCss || [];

  for (let i = 0; i < linkedCss.length; i++) {
    const item = linkedCss[i];
    const elem = $(`link[href="${item.from}"]`);

    const modded = elem.attr('href', item.to);
    $(elem).replaceWith(wrapCheerioElem(modded));
  }

  return $.html();
}

export async function updateScriptTagJs(code) {
  const $ = cheerio.load(code);
  const scriptTags = $('script');

  for (const elem of scriptTags) {
    const innerJs = $(elem).html();
    const res = innerJs; // processJs(innerJs);
    $(elem).html(res);
  }

  return $.html();
}

export async function updateStyleTagCss(config, code, file = '') {
  const $ = cheerio.load(code);
  const styleTags = $('style');

  for (const elem of styleTags) {
    const innerCss = $(elem).html();

    // this element start index in the code
    const elemIndex = code.indexOf(innerCss);
    const startIndex = code.substring(0, elemIndex)
      .split(EOL).length;

    // minus the top style tag, openning tag
    // because when spliting by EOL, the first EOL is from
    // the openning style tag
    const styleTagCount = 1;

    const res = await processCss(config, file, '', {
      justCode: innerCss,
      startIndex: startIndex - styleTagCount
    });
    $(elem).html(res.css);
  }

  return $.html();
}

export async function validateAndUpdateHtml(config, data) {
  const compiled = data.html;
  const outname = data.name;
  const htmlOutFile = data.outputPath.join(data.srcBase, outname).full;

  const tmpfile = tmp.fileSync({
    dir: vpath([defaultConfig.name, 'html']).full
  }).name;

  const html = {
    from: data.viewPath,
    out: htmlOutFile,
    code: compiled,
    tmpfile
  };

  try {
    const exists = keep.get(html.from);
    let linked = {};
    let assets = {};

    if (!exists.isValidHtml) {
      validateHtml(config, html.code.toString(), {
        view: data.viewPath
      });
      keep.upsert(html.from, { isValidHtml: true });
    }

    // parse html and get linked assets
    linked = parseHtmlLinked(config, html.code);
    // an object of schema { [ext]: [] } / ex: { '.css': [] }
    assets = await processLinkedAssets(config, linked);

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
