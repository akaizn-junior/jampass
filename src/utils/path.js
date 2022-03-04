// node
import fs from 'fs';
import path from 'path';

/**
 * Validates and parses a path
 * @param {string|string[]} p The path to parse or a list of paths
 * @param {boolean} withStats Get path stats
 */
export function vpath(p, withStats = false) {
  try {
    let stats = null;
    const str = Array.isArray(p) ? path.join(...p) : p;
    if (withStats) stats = fs.statSync(str); // for now this stays a sync op
    const parsed = path.parse(str);

    return {
      ...parsed,
      stats,
      full: str,
      noext: str.split(parsed.ext)[0],
      join: (...paths) => vpath([str, ...paths], withStats)
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Reads a directory for a list of paths
 * @param {string} srcPath The source path to check files on
 * @param {string} dirType How to list files, full directories or subdir only
 * @param {string} dir Private recursive dir to build directory filenames
 */
export async function getDirPaths(srcPath, dirType = 'sub', dir = '') {
  try {
    const ignore = [
      'node_modules'
    ];

    let dirents = await fs.promises.readdir(srcPath, {
      withFileTypes: true
    });

    dirents = dirents
      .filter(d => !(d.name.startsWith('.') || ignore.includes(d.name)));

    const ps = dirents.map(async dirent => {
      if (dirent.isDirectory()) {
        return await getDirPaths(path.join(srcPath, dirent.name),
          dirType,
          path.join(dir, dirent.name)
        );
      }
      return dirType === 'full' ? path.join(srcPath, dirent.name)
        : path.join(path.parse(dir).dir, path.parse(dir).base, dirent.name);
    });

    // something like an async flat map
    return Promise.all(
      [].concat(
        ...await Promise.all(
          ps
        )
      )
    );
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function pathDistance(src, target) {
  const TRAIL = '..'.concat(path.sep);

  const separate = (a, b) => {
    let sPath = '';
    let tPath = '';
    let root = '';
    const s = a.split(path.sep);
    const t = b.split(path.sep);
    const len = s.length > t.length ? s.length : t.length;

    let j = 0;
    while (j < len) {
      const sPart = s[j];
      const tPart = t[j];

      if (sPart !== tPart && tPart) {
        tPath = tPath.concat(tPath.length ? path.sep : '', tPart);
      }

      if (sPart !== tPart && sPart) {
        sPath = sPath.concat(sPath.length ? path.sep : '', sPart);
      }

      if (sPart && tPart && sPart === tPart) {
        root = root.concat(sPart, path.sep);
      }

      j++;
    }

    return { root, sPath, tPath };
  };

  const { root, sPath, tPath } = separate(src, target);

  if (!root) {
    throw Error('Paths do not exist in the same root directory');
  }

  // ignore filenames from the src path
  const sPathDir = vpath(sPath).dir;
  const tPathDir = vpath(tPath).dir;
  // get the length of the path split by 'path.sep'
  // the diff between src path and root path without src filename
  const diff = sPathDir ? sPathDir.split(path.sep).length : 0;
  const tDiff = tPathDir ? tPathDir.split(path.sep).length : 0;
  let trail = '';

  for (let i = 0; i < diff; i++) {
    trail = trail.concat(TRAIL);
  }

  const distance = {
    root,
    src: sPath,
    target: tPath,
    trail,
    srcDiff: diff,
    targetDiff: tDiff,
    distance: trail.concat(tPath)
  };

  return distance;
}

export function splitPathCwd(cwd, s) {
  if (s.startsWith(cwd)) {
    const p = s.split(cwd + path.sep)[1];
    return p;
  }
  return s;
}

export function getSrcBase(config, withCwd = true) {
  // allow multiple folders in the output directory
  if (config.multi) {
    return vpath([withCwd ? config.cwd : '', config.src]).base;
  }
  return '';
}

/**
 *
 * @param {string} dirname directory name
 */
export function createDirSync(dirname) {
  try {
    // does it exist
    fs.statSync(dirname);
  } catch (err) {
    // create
    fs.mkdirSync(dirname);
  }

  return dirname;
}
