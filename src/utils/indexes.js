import * as marky from 'marky';
import { blue } from 'colorette';

// local
import { accessProperty, parsedNameKeysToPath, parseDynamicName } from './process.js';
import { debuglog } from './init.js';
import { formatBytes, markyStop, showTime, getDataItemPageClosure } from './helpers.js';
import { getSrcBase, vpath } from './path.js';
import { writeFile, newReadable } from './stream.js';
import * as keep from './keep.js';

export async function buildIndexes(config) {
  const { indexes } = config.funneled;
  const { indexKeyMaxSize, resultUrl } = config.build.search;

  if (!indexes || !indexes.length) return;

  const parsed = parseDynamicName(resultUrl);
  const getItemPage = getDataItemPageClosure(config);

  const _indexKeyMaxSize = indexKeyMaxSize || 100;
  const rawData = config.funneled?.raw;
  const isArray = Array.isArray(rawData);
  let file = '';

  // indexes may be too BIG
  // lets just use string and the super fast JSON.parse
  // of course with 'reduce'
  // JSON parse and JSON.stringify work with chunks

  const getIndexes = (locals, rawDataItemIndex = 0) => {
    const pageEntry = getItemPage(rawDataItemIndex);

    return indexes.reduce((acc, index) => {
      const _acc = JSON.parse(acc);

      try {
        const value = accessProperty(locals, index);
        const isValidIndex = value.length <= _indexKeyMaxSize;

        if (isValidIndex) {
          _acc[value] = {
            index,
            value: locals
          };

          if (parsed && parsed.place) {
            const prop = parsedNameKeysToPath(parsed.keys, locals);
            const pathName = parsed.place(prop);
            const page = vpath([pageEntry, pathName]).full;
            page && (_acc[value].url = page);
          }
        }
      } catch (err) {
        debuglog(blue('skipped'), `"${index}" is undefined. cannot set index`);
      }

      return JSON.stringify(_acc);
    }, '{}');
  };

  const fnm = 'indexes.json';
  const exists = keep.get(fnm);

  if (!exists || config.watchFunnel) {
    marky.mark('build search');

    if (isArray) {
      file = rawData.reduce((acc, locals, i) => {
        const _acc = JSON.parse(acc);
        const ind = JSON.parse(getIndexes(locals, i));
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

        debuglog('generated indexes "%s" -', fnm,
          formatBytes(file.length), time);
      });
    });

    keep.upsert(fnm, { name: fnm, processed: true });
  }
}
