# Jesse

![Another one](https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif)

A static site generator.

## Template Engine

Jesse comes out of the box with handlebars.

With additional support for any template engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports

Config Jesse to use your favorite engine.

## Config

```js
// default config
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
