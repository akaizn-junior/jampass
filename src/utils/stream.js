// node
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { Readable } from 'stream';

// local
import { vpath } from './path.js';
import { safeFun } from './helpers.js';

/**
 * write data to file
 * @see https://nodejs.org/api/fs.html#file-system-flags
 * @param {string|object} from source file, Readable or ReadStream
 * @param {string} to destination file
 * @param {function} onend runs at the end of the stream
 * @param {object} opts options
 */
export async function writeFile(from, to, onend = null, opts = {}) {
  const _opts = Object.assign({
    flags: 'w+', dry: false
  }, opts);

  const source = typeof from === 'string' ? vpath(from, true).full : from;
  const dest = vpath(to);

  async function asyncWrite(rs, ws) {
    for await (const chunk of rs) {
      ws.write(chunk);
    }
  }

  const done = () => {
    if (!_opts.dry) {
      let rs = source; // source is a Readable or ReadStream
      if (typeof source === 'string') rs = createReadStream(source);

      const ws = createWriteStream(dest.full, { flags: _opts.flags });
      asyncWrite(rs, ws);

      rs.on('end', async() => {
        safeFun(onend)();
      });
    }
  };

  try {
    const stats = await fs.stat(dest.dir);
    if (!stats.isDirectory()) {
      throw Error('public output must be a directory');
    }

    return done();
  } catch {
    if (!_opts.dry) {
      try {
        await fs.mkdir(dest.dir, { recursive: true });
        return done();
      } catch (e) {
        throw e;
      }
    }
  }
}

export function newReadable(data) {
  const rs = new Readable({
    highWaterMark: 64 * 1024, // ReadStream high water mark
    read(size) {
      // increase the size 'highWaterMark'
      // from the default 16kb to ReadStreams's 64kb
      const _size = size;
      let i = 0;
      while (i <= data?.length) {
        const chunk = String(data).substring(i, _size + i);
        rs.push(chunk);

        i += _size;
      }
      rs.push(null);
    }
  });
  return rs;
}

export async function asyncRead(file, proc = c => c) {
  try {
    const rs = createReadStream(file);
    const _proc = safeFun(proc);
    let res = '';

    for await (const chunk of rs) {
      res += _proc(chunk);
    }

    return res;
  } catch (err) {
    throw err;
  }
}

export async function * htmlsNamesGenerator(htmls, names) {
  const size = 500;

  if (htmls.length > size) {
    const chunks = Math.floor(htmls.length / size);

    for (let i = 0; i < chunks; i++) {
      yield {
        htmls: htmls.splice(0, size),
        names: names.splice(0, size)
      };
    }
  }

  yield {
    htmls: htmls.splice(0, htmls.length),
    names: names.splice(0, names.length)
  };
}
