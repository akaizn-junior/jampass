import * as marky from 'marky';

// local
import { accessProperty, processJs } from './process.js';
import { logger, markyStop } from './helpers.js';
import { getSrcBase, vpath } from './path.js';
import { writeFile, newReadable } from './stream.js';
import * as keep from './keep.js';

export async function buildSearch(config, funneled) {
  marky.mark('build search');
  const { indexes, indexKeyMaxSize } = config.build.search;

  if (!indexes || !indexes.length) return;

  const _indexKeyMaxSize = indexKeyMaxSize || 100;
  const data = funneled.data;
  const isArray = Array.isArray(data);
  let file = '';

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
      markyStop('build search', {
        log: end => logger.success('generated indexes "%s" -', fnm,
          file.length,
          `bytes - ${end}s`)
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
    const srcBase = getSrcBase(config, false);
    const out = vpath([config.owd, config.output.path, srcBase, name]).full;

    marky.mark('bundle search');
    const { to, code } = await processJs(config, file, out, {
      libName: 'Search',
      hash: false
    });

    writeFile(newReadable(code), to, () => {
      markyStop('bundle search', {
        log: end => logger.success('bundled search "search.min.js" -',
          code.length,
          `bytes - ${end}s`)
      });
    });

    keep.add(name, { name, processed: true });
  }
}
