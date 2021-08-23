# Jampass

![Another one](https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif)

A static site generator.

Jampass easily helps you funnel data from any headless cms to your templates.

## Edge

Jampass is still in edge developemt, use it for testing only. Things are bound to change at anytime.
If you would like to help, email me at sdnziaka@gmail.com.

## Example

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

## Template Engine

Jampass comes out of the box with support for [handlebars](https://www.npmjs.com/package/handlebars).

With additional support for any template engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports.

## Author

(c) 2021 Simao Nziaka
