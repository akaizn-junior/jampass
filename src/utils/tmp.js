import { createHash } from './helpers.js';
import { tmpdir } from './init.js';
import { createDirSync, vpath } from './path.js';
import { newReadable, writeFile } from './stream.js';

/**
 * Obfuscates the file name and creates a temporary file.
 * The tmp file may or may not contain an extension and data
 * @param {string} name a dir name
 * @param {string} tmpBase the tmp dir from where to create a new dir
 * @param {string} ext an optional extension for the temporary file
 * @param {any} data data to write
 */
export async function tmpFile(name, tmpBase = 'base', ext = '', data = '') {
  // obfuscate the name, what it is does not matter
  // as long as its the same everytime
  const h = createHash(name, 12);
  const p = vpath([tmpdir[tmpBase], h.concat(ext)]).full;
  // the tmp file may be created for later use
  // so data may not be given
  // cover the case where data is given
  data = !data ? newReadable(data) : data;
  await writeFile(data, p, null, { verifyPath: false });
  return p;
}

/**
 * Obfuscates the dir name and creates a temporary directory
 * @param {string} name a dir name
 * @param {string} tmpBase the tmp dir from where to create a new dir
 */
export function tmpDirSync(name, tmpBase = 'base') {
  // obfuscate the name, what it is does not matter
  // as long as its the same everytime
  const h = createHash(name, 12);
  const p = vpath([tmpdir[tmpBase], h]).full;
  return createDirSync(p);
}
