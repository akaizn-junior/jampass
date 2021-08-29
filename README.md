# Jampass

![Another one](https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif)

A static site generator.

Jampass easily helps you funnel data from any headless cms to your templates.

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

Jampass aims bridge the gap between content making and content publishing.
The system helps funnel data to your templates to generate HTML, while providing a modern development environment.

Build your site with the latest browser-ready CSS and JavaScript, along side  server side JavaScript to seamlessly generate a fully static site.

Jampass supports, *locales*, *pagination*, build time variables along side your template data, site *subdirectories*, multiple pages generation based on *slugs*, *index* generation for search.

...

## Template Engine

Jampass comes out of the box with support for [handlebars](https://www.npmjs.com/package/handlebars).

With additional support for any template engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports.

## Author

(c) 2021 Simao Nziaka
