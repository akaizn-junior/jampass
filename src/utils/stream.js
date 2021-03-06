// node
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { Readable } from 'stream';

// local
import { createDir, vpath } from './path.js';
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
    flags: 'w+',
    dry: false,
    verifyPath: true
  }, opts);

  const source = typeof from === 'string'
  // assume is a path
    ? vpath(from, _opts.verifyPath).full : from;
  // destination path
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

  await createDir(dest.dir, done, { dry: false });
}

export async function symlink(from, to, opts = {}) {
  const _opts = Object.assign({
    dry: false
  }, opts);

  // destination path
  const dest = vpath(to);
  const done = async() => {
    await fs.symlink(from, dest.full, 'dir');
  };

  await createDir(dest.dir, done, { dry: _opts.dry });
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
