import fs from 'fs';

// get the content of package.json for completeness
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url))
);

export default {
  name: pkg.name,
  version: pkg.version,
  rcFileName: 'jampass.config.js',
  funnelName: 'jampass.data.js',
  funnelDefaultKeys: {
    raw: [],
    meta: {},
    pages: [],
    partials: {},
    fromFiles: []
  },
  userOpts: {
    cwd: process.cwd(),
    src: '',
    locales: [],
    build: {
      debug: false,
      watchFunnel: false,
      search: {
        indexKeyMaxSize: 60,
        lib: false,
        resultUrl: ''
      }
    },
    views: {
      engine: {
        name: 'handlebars',
        config: () => {}
      },
      remote: false,
      path: 'views'
    },
    output: {
      multi: false,
      remote: false,
      path: 'public'
    },
    devServer: {
      port: 2000,
      directory: false,
      open: false,
      pages: {
        404: '/'
      }
    }
  }
};
