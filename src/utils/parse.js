import { HtmlValidate } from 'html-validate';
import * as cheerio from 'cheerio';
import del from 'del';

// node
import { EOL } from 'os';

// local
import { vpath, splitPathCwd } from './path.js';
import { debuglog } from './init.js';
import { getSnippet, minifyHtml } from './helpers.js';
import { writeFile, newReadable } from './stream.js';
import { processCss, processLinkedAssets } from './process.js';
import * as keep from './keep.js';

const wrapCheerioElem = m => '\n'.concat(m, '\n');

export async function validateHtml(config, html, opts) {
  if (!html || typeof html !== 'string') {
    throw Error(`validateHtml() takes a html string. "${html}" given`);
  }

  const _extends = ['html-validate:recommended'];

  try {
    const userConfig = vpath([config.cwd, config.src, '.htmlvalidate.json'], true).full;
    _extends.push(userConfig);
  } catch {
    // pass
  }

  try {
    const validate = new HtmlValidate({
      root: false,
      extends: _extends
    });

    const res = validate.validateString(html);

    const handleMsg = async msg => {
      const emsg = splitPathCwd(config.cwd, opts.view)
        .concat(':', msg.line, ':', msg.column);

      msg.name = 'HtmlValidatorError';
      msg.snippet = await getSnippet({
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

function captureAsset(config, cheerioElement, attr) {
  const linked = { ext: [] };
  const capture = (ext, data) => {
    if (!linked[ext]) {
      linked[ext] = [data];
      linked.ext.push(ext);
    } else {
      linked[ext].push(data);
    }
  };

  const isNotDataUrlOrThrow = str => {
    if (str.startsWith('data:')) {
      const err = Error();
      err.code = 'ENOENT';
      throw err;
    }
    return str;
  };

  cheerioElement.each((_, el) => {
    try {
      // verify if attribute is not a data url
      const _path = isNotDataUrlOrThrow(el.attribs[attr]);

      // verify if path of asset exists locally
      const assetPath = vpath(
        [config.cwd, config.src, _path],
        true
      );

      const data = {
        ext: assetPath.ext,
        assetPath: assetPath.full,
        ...el.attribs
      };

      capture(assetPath.ext, data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  });

  return linked;
}

export function parseHtmlLinked(config, code) {
  const $ = cheerio.load(code);
  const linked = {};

  const capture = items => {
    if (items) {
      for (const e of items.ext) {
        linked[e] = items[e];
      }
    }
  };

  const hrefs = captureAsset(config, $('link[rel]'), 'href');
  const scripts = captureAsset(config, $('script[src]'), 'src');
  const imgs = captureAsset(config, $('img[src]'), 'src');

  capture(hrefs);
  capture(scripts);
  capture(imgs);

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

  const html = {
    from: data.viewPath,
    out: htmlOutFile,
    code: compiled
  };

  try {
    const exists = keep.get(html.from);

    if (!exists.isValidHtml) {
      validateHtml(config, html.code.toString(), {
        view: data.viewPath
      });

      keep.upsert(html.from, { isValidHtml: true });
    }

    // parse html and get linked assets
    const linked = parseHtmlLinked(config, html.code);
    const assets = await processLinkedAssets(config, html, linked);
    keep.appendHtmlTo(html.from, html.out, html);

    return await updateAndWriteHtml(config, { html, assets });
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

    if (config.isDev) {
      await writeFile(newReadable(uScriptTags), html.out);
    } else {
      const min = await minifyHtml(config, uScriptTags);
      await writeFile(newReadable(min), html.out);
    }
  } catch (err) {
    throw err;
  }
}
