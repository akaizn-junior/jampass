# Jesse

![Another one](https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif)

A static site generator.

Jesse easily helps you funnel data from any headless cms to your templates.

## Example

```js
// filename: .jesse.js

const Jesse = require('jesse');

// Use any headless CMS, we use contentful here just as an example
const contentful = require('contentful');

Jesse.funnel(async () => {
  const client = contentful.createClient({ ... })
  const entries = await client.getEntries({ ... })

  const result = entries.map(entry => {
    ...
  })

  return result;
})

// Jesse will use default configurations, then, voilá!

```

## Template Engine

Jesse comes out of the box with support for [handlebars](https://www.npmjs.com/package/handlebars).

With additional support for any template engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports.

## Default Config

```js
{
  root: '.',
  input: {
    remote: false,
    templates: './views'
  },
  output: {
    remote: false,
    public: './public',
    tmp: './tmp'
  },
  engine: 'handlebars'
}
```

## Author

(c) 2021 Simao Nziaka
