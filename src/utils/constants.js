import path from 'path';

// tokens
export const FIELD_BEGIN_TOKEN = '[';
export const FIELD_END_TOKEN = ']';
export const PATH_TOKEN = '_';
export const INDEX_TOKEN = ':';
export const LOOP_TOKEN = '-';
export const PAGE_TOKEN = '#';
export const PARTIALS_TOKEN = '__';

// paths
export const LOCALES_PATH_NAME = `${path.sep}locales`;
export const LOCALES_PATH_EXT = ['.json', '.locale.json'];
export const PARTIALS_PATH_NAME = `${path.sep}partials`;
export const VIEWS_PATH_NAME = `${path.sep}views`;
export const VIEWS_PATH_EXT = ['.htm', '.html'];
export const DATA_PATH_NAME = `${path.sep}data`;
export const DATA_PATH_EXT = ['.data.md', '.data.txt'];
export const SCRIPT_PATH_NAME = `${path.sep}script`;
export const SCRIPT_PATH_EXT = ['.js', '.mjs'];
export const STYLE_PATH_NAME = `${path.sep}style`;
export const STYLE_PATH_EXT = ['.css', '.scss', '.sass'];
export const STATIC_PATH_NAME = `${path.sep}static`;
export const STATIC_PATH_EXT = '.static';

// other
export const INDEX_PAGE = 'index.html';
export const LOCALES_SEP = '_';
export const MAX_RECURSIVE_ACESS = 7;
export const DEFAULT_PAGE_NUMBER = 1;
