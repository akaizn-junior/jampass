# Jampass

![Another one](./jampass-logo.png)

A static site generator.

## Install

```bash
 npm i jampass
```

## Edge

Jampass is still in edge developemt, use it for testing only. Things are bound to change at anytime.
If you would like to contribute, email me at sdnziaka@gmail.com.

## Example

See a working example of how to implement under the 'test' folder on github.

```js
// filename: jampass.config.js

const Jampass = require('jampass');

// Use any headless CMS, we use contentful here just as an example
const contentful = require('contentful');

Jampass.funnel(async () => {
  const client = contentful.createClient({ ... })
  const entries = await client.getEntries({ ... })

  const result = entries.map(entry => {
    ...
  })

  return result;
})

// Jampass will use default configurations, then, voilá!

```

## Docs

Jampass aims to bridge the gap between content making and content publishing.
The system helps funnel data to your templates to generate HTML, while providing a modern development environment.

Jampass supports, *locales*, *pagination*, build-time variables along side your template data, site *subdirectories*, multiple pages generation based on *slugs*, *indexes* generation for search and much more.

...

## Template Engine

Jampass comes out of the box with support for [handlebars](https://www.npmjs.com/package/handlebars).

With additional support for any template engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports.

## Author

(c) 2021 Simao Nziaka
