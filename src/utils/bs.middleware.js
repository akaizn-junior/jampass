import fs from 'fs';
import { asyncRead } from './stream.js';
import { vpath } from './path.js';
import { INDEX_PAGE } from './constants.js';

const isHtml = ext => ['', '.htm', '.html'].includes(ext);

function redirectToEntryWithSlash(opts) {
  return (req, res, next) => {
    const url = new URL(`${opts.host}:${opts.port}${req.url}`);
    const uri = url.pathname;

    // for multi public output ignore entry directory
    if (opts.entry.endsWith(uri)) {
      res.writeHead(302, {
        location: `${uri}/`,
        'Content-Type': 'text/html'
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

    if (uri.endsWith(INDEX_PAGE)) {
      res.writeHead(302, {
        location: uri.replace(/index.html$/, ''),
        'Content-Type': 'text/html'
      });
      res.end();
      return;
    }

    if (uri.endsWith('.html')) {
      res.writeHead(302, {
        location: uri.replace(/.html$/, ''),
        'Content-Type': 'text/html'
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

    // ignore other extensions
    const ext = vpath(uri).ext;
    if (!isHtml(ext)) {
      return next();
    }

    // ignore directories
    if (uri.endsWith('/')) {
      return next();
    }

    const possible = [
      `${opts.serverRoot + uri}.html`,
      `${opts.serverRoot + uri}/index.html`,
      `${opts.serverRoot + uri}.htm`,
      `${opts.serverRoot + uri}/index.htm`
    ];

    const exists = possible.filter(u => fs.existsSync(u));
    if (exists.length) {
      const file = exists[0];

      await asyncRead(file, chunk => {
        res.write(chunk);
      });

      res.writeHead(200, {
        'Content-Type': 'text/html'
      });
      res.end();
      return;
    }

    return next();
  };
}

export function restMiddleware(pagePath) {
  return async(req, res) => {
    // ignore other extensions
    const ext = vpath(req.url).ext;
    if (isHtml(ext)) {
      res.writeHead(302, {
        location: pagePath,
        'Content-Type': 'text/html'
      });
    } else {
      res.statusCode = 404;
    }

    res.end('Not Found!');
  };
}

export function middlewareList(opts) {
  return [
    redirectToEntryWithSlash(opts),
    redirectIfEndsWith(opts),
    writePageContent(opts)
  ];
}
