import fs from 'fs/promises';
import { existsSync } from 'fs';

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

    const exists = possible.filter(u => existsSync(u));
    if (exists.length) {
      const file = exists[0];
      const content = await fs.readFile(file);

      res.write(content);
      res.writeHead(200);
      res.end();
      return;
    }

    return next();
  };
}

export default function middleware(opts) {
  return [
    redirectToEntryWithSlash(opts),
    redirectIfEndsWith(opts),
    writePageContent(opts)
  ];
}
