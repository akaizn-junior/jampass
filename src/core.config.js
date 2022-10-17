import fs from 'fs';
import { isObj, isString } from './util/helpers.js';

// get the content of package.json for completeness
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url))
);

// Config shell

export const __name = pkg.name;
export const __version = pkg.version;
export const __jsRcName = 'jampass.config.js';
export const __jsDataFile = 'jampass.data.js';

// Data file Schema

export const dataFileSchema = {
  raw: {
    type: Array.isArray,
    default: []
  },
  meta: {
    type: isObj,
    default: {}
  },
  pages: {
    type: Array.isArray,
    default: []
  },
  partials: {
    type: isObj,
    default: {}
  },
  fromFiles: {
    type: Array.isArray,
    default: []
  }
};

// User file Schema

export const userConfigSchema = {
  cwd: {
    type: isString,
    default: process.cwd()
  },
  src: {
    type: isString,
    default: '.'
  },
  locales: {
    type: Array.isArray,
    default: []
  },
  build: {
    type: isObj,
    default: {
      debug: false,
      datawatch: true,
      search: {
        indexKeyMaxSize: 60,
        resultUrl: ''
      }
    }
  },
  views: {
    type: isObj,
    default: {
      remote: false,
      path: 'views'
    }
  },
  output: {
    type: isObj,
    default: {
      multi: false,
      remote: false,
      path: 'public'
    }
  },
  devServer: {
    type: isObj,
    default: {
      host: 'http://localhost',
      port: 2000,
      directory: false,
      open: false,
      pages: {
        404: '/',
        500: '/'
      }
    }
  }
};
