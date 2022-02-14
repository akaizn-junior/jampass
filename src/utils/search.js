import * as marky from 'marky';

// local
import { accessProperty, processJs } from './process.js';
import { logger } from './init.js';
import { markyStop, showTime } from './helpers.js';
import { getSrcBase, vpath } from './path.js';
import { writeFile, newReadable } from './stream.js';
import * as keep from './keep.js';

export async function buildSearch(config) {
  const { indexes, indexKeyMaxSize } = config.build.search;

  if (!indexes || !indexes.length) return;

  const _indexKeyMaxSize = indexKeyMaxSize || 100;
  const data = config.funneled.data;
  const isArray = Array.isArray(data);
  let file = '';

  // indexes may be too BIG
  // lets just use string and the super fast JSON.parse
  // of course with 'reduce'
  // JSON parse and JSON.stringify work with chunks
  const getIndexes = locals => indexes
    .reduce((acc, index) => {
      const _acc = JSON.parse(acc);

      try {
        const value = accessProperty(locals, index);
        const isIndex = value.length <= _indexKeyMaxSize;

        if (isIndex) {
          _acc[value] = {
            index,
            value: locals
          };
        }
      } catch (err) {
        logger.info('key "%s" is undefined.', index, 'Skipped index');
      }

      return JSON.stringify(_acc);
    }, '{}');

  const fnm = 'indexes.json';
  const exists = keep.get(fnm);

  if (!exists || config.watchFunnel) {
    marky.mark('build search');

    if (isArray) {
      file = data.reduce((acc, locals) => {
        const _acc = JSON.parse(acc);
        const ind = JSON.parse(getIndexes(locals));
        const res = Object.assign(_acc, ind);
        return JSON.stringify(res);
      }, '{}');
    } else {
      file = getIndexes(data);
    }

    const srcBase = getSrcBase(config, false);
    const out = vpath([config.owd, config.output.path, srcBase, fnm]).full;

    writeFile(newReadable(file), out, () => {
      markyStop('build search', end => {
        const lap = markyStop('build time');
        const time = showTime(end, lap);

        logger.success('generated indexes "%s" -', fnm,
          file.length, 'bytes', time);
      });
    });

    keep.upsert(fnm, { name: fnm, processed: true });
  }
}

export async function bundleSearchFeature(config, file, name) {
  const exists = keep.get(name);
  const { indexes, lib } = config.build.search;

  if (!indexes || !indexes.length) return;

  if (!exists && lib) {
    marky.mark('bundle search');

    const srcBase = getSrcBase(config, false);
    const out = vpath([config.owd, config.output.path, srcBase, name]).full;

    const { to, code } = await processJs(config, file, out, {
      libName: 'Search',
      hash: false
    });

    writeFile(newReadable(code), to, () => {
      markyStop('bundle search', end => {
        const lap = markyStop('build time');
        const time = showTime(end, lap);

        logger.success('bundled search "search.min.js" -',
          code.length, 'bytes', time);
      });
    });

    keep.add(name, { name, processed: true });
  }
}
