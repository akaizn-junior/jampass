import * as marky from 'marky';
import { blue } from 'colorette';

// local
import { accessProperty, processJs } from './process.js';
import { logger } from './init.js';
import { formatBytes, markyStop, showTime } from './helpers.js';
import { getSrcBase, vpath } from './path.js';
import { writeFile, newReadable } from './stream.js';
import * as keep from './keep.js';

export async function buildIndexes(config) {
  const { indexes } = config.funneled;
  const { indexKeyMaxSize } = config.build.search;

  if (!indexes || !indexes.length) return;

  const _indexKeyMaxSize = indexKeyMaxSize || 100;
  const rawData = config.funneled.raw;
  const isArray = Array.isArray(rawData);
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
        const isValidIndex = value.length <= _indexKeyMaxSize;

        if (isValidIndex) {
          _acc[value] = {
            index,
            value: locals
          };
        }
      } catch (err) {
        logger.info(blue('skipped'), `"${index}" is undefined. cannot set index`);
      }

      return JSON.stringify(_acc);
    }, '{}');

  const fnm = 'indexes.json';
  const exists = keep.get(fnm);

  if (!exists || config.watchFunnel) {
    marky.mark('build search');

    if (isArray) {
      file = rawData.reduce((acc, locals) => {
        const _acc = JSON.parse(acc);
        const ind = JSON.parse(getIndexes(locals));
        const res = Object.assign(_acc, ind);
        return JSON.stringify(res);
      }, '{}');
    } else {
      file = getIndexes(rawData);
    }

    const srcBase = getSrcBase(config, false);
    const out = vpath([config.owd, config.output.path, srcBase, fnm]).full;

    writeFile(newReadable(file), out, () => {
      markyStop('build search', end => {
        const lap = markyStop('build time');
        const time = showTime(end, lap);

        logger.success('generated indexes "%s" -', fnm,
          formatBytes(file.length), time);
      });
    });

    keep.upsert(fnm, { name: fnm, processed: true });
  }
}

export async function bundleSearchFeature(config) {
  const file = 'src/search/index.js';
  const name = 'search.min.js';

  const exists = keep.get(name);
  const { indexes } = config.funneled;
  const { lib } = config.build.search;

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
          formatBytes(code.length), time);
      });
    });

    keep.add(name, { name, processed: true });
  }
}
