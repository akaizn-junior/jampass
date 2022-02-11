import htmlValidator from 'html-validator';
import cheerio from 'cheerio';
import del from 'del';

// node
import { EOL } from 'os';

// local
import { vpath, splitPathCwd, pathDistance } from './path.js';
import { logger, tmpdir, debuglog, minifyHtml } from './helpers.js';
import { writeFile, newReadable} from './stream.js';
import { spliceCodeSnippet, processCss, processLinkedAssets } from './process.js';
import * as keep from './keep.js';

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
    const res = await htmlValidator({
      data: html,
      format: 'text',
      validator: 'WHATWG'
    });

    const msg = err => {
      const emsg = splitPathCwd(config.cwd, opts.view)
        .concat(':', err.line, ':', err.column);

      logger.log(EOL);
      logger.log('HtmlValidatorError', emsg, `"${err.ruleId}"`, err.message, EOL);
    };

    res.errors.forEach(err => {
      msg(err);
      logger.log(spliceCodeSnippet(html, err.line, err.column));
    });

    res.warnings.forEach(warn => {
      msg(warn);
      logger.log(spliceCodeSnippet(html, warn.line, warn.column));
    });

    if (!res.isValid) throw Error('HtmlValidatorError');
    return res.isValid;
  } catch (err) {
    err.name = 'HtmlValidatorError';
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

  const notFoundLog = asset => {
    const exists = keep.get(`${asset}-404`);
    !exists && logger.log('"%s" not found locally. skipped', asset);
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
        notFoundLog(el.attribs.href);
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
        notFoundLog(el.attribs.src);
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
    const eIndex = code.indexOf(innerCss);
    const startIndex = code.substring(0, eIndex)
      .split(EOL).length;

    const res = await processCss(config, file, '', {
      justCode: innerCss,
      startIndex: startIndex - 1
    });
    $(elem).html(res.css);
  }

  return $.html();
}

export async function validateAndUpdateHtml(config, data) {
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
    const exists = keep.get(html.from);
    if (!exists.isValidHtml) {
      validateHtml(config, html.code.toString(), {
        view: data.viewPath
      });
      exists.isValidHtml = true;
    }

    // parse html and get linked assets
    const linked = parseHtmlLinked(config, html.code);
    // an object of schema { [ext]: [] } / ex: { '.css': [] }
    const assets = await processLinkedAssets(config, linked);
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
