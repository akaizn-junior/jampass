import fs from 'fs';

// get the content of package.json for completeness
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url))
);

export default {
  name: pkg.name,
  version: pkg.version,
  configFile: 'jampass.config.js',
  userOpts: {
    cwd: process.cwd(),
    src: './demos/site',
    debug: false,
    locales: [],
    funnel: 'jampass.data.js',
    watchFunnel: false,
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
      enableListing: false,
      pages: {
        404: '/site/404.html'
      }
    }
  }
};
