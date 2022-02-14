import fs from 'fs';
import { asyncRead } from './stream.js';

function redirectToEntryWithSlash(opts) {
  return (req, res, next) => {
    const url = new URL(`${opts.host}:${opts.port}${req.url}`);
    const uri = url.pathname;

    // for multi public output ignore entry directory
    if (opts.entry.endsWith(uri)) {
      res.writeHead(302, {
        location: `${uri}/`
      });
      res.end();
      return;
    }

    return next();
  };
}

function redirectIfEndsWith(opts) {
  return (req, res, next) => {
    const url = new URL(`${opts.host}:${opts.port}${req.url}`);
    const uri = url.pathname;

    if (uri.endsWith('index.html')) {
      res.writeHead(302, {
        location: uri.replace(/index.html$/, '')
      });
      res.end();
      return;
    }

    if (uri.endsWith('.html')) {
      res.writeHead(302, {
        location: uri.replace(/.html$/, '')
      });
      res.end();
      return;
    }

    return next();
  };
}

function writePageContent(opts) {
  return async(req, res, next) => {
    const url = new URL(`${opts.host}:${opts.port}${req.url}`);
    const uri = url.pathname;

    const possible = [
      `${opts.serverRoot + uri}.html`,
      `${opts.serverRoot + uri}/index.html`
    ];

    const exists = possible.filter(u => fs.existsSync(u));
    if (exists.length) {
      const file = exists[0];

      await asyncRead(file, chunk => {
        res.write(chunk);
      });

      res.writeHead(200);
      res.end();
      return;
    }

    return next();
  };
}

export function restMiddleware(pagePath) {
  return async(_, res) => {
    res.writeHead(302, {
      location: pagePath
    });

    res.end('404');
  };
}

export function middlewareList(opts) {
  return [
    redirectToEntryWithSlash(opts),
    redirectIfEndsWith(opts),
    writePageContent(opts)
  ];
}
