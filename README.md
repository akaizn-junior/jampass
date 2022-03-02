# Jampass

![Another one](./jampass-logo.png)

A static site generator.

## Install

```bash
 npm i -D jampass
```

## Guide

Jampass aims to bridge the gap between content making and content publishing.
The system helps funnel data to your templates to generate HTML super fast, while providing a modern development environment.

### init

Jampass wants to be out of the way as best as it can; so there are a few ways you may init a project and build it, ready for publishing.

The #1 approach is the **just in time** approach. With the JIT approach Jampass will look for an all html files on the root of the project, parse the files and output the results on a folder named *public*. You may create or already have a vanilla web (html, css, js) project and simply run `jampass -s <source path>`. Jampass will only focus on html and linked assets with this approach, see the documentation for more details on specific naming considered by the JIT approach.

The second approach is the **tidy** approach. With the tidy approach Jampass will look for specific folders to build from; the default folders: *views*, *static*, *locales* and others will include relevant files to use during the build process. See documentation for more.

The third and final approach is the **with config** approach. Jampass allows for some configuration, although our efforts are to make it so configuration stays at a minimum, developers may taylor their experience on the *jampass.config.js* file. See docs for more.

The approaches defined above allow for a consistent development platform, however, Jampass does mix and match how it reads the source base in order to generate a static site.

### Data

Independently of your setup, Jampass will only read data from *jampass.data.js*. Jampass completely stays out of your way when it comes to data. Want to use a headless CMS or markdown, set it up in *jampass.data.js* and then export the relevant keys for data consumption. We call it data funneling.

```js

export default {
  raw: ...
}

```

Jampass will check for data under the `raw` key. See docs for more.

### Pagination

Jampass will check *jampass.data.js* for the *pagination* key in order to funnel pagination data. if *raw* and *pages* data match, no *pages* key is needed, pages will be generated from the *raw* data, for *every* data read.

```js

export default {
  raw: ...,
  pagination: {
    pages: ...,
    every: 5 // generate output every pages items read
  }
}

```

In addition to definning where pages come from, you need to define what html view is going to generate pages as output. Use the *dash (-)* token in order to let Jampass know what view will be used for pages. For example: the view `-blog[_slug].html` will generate n pages based on pages data, named as `blog/{slug}.html`. Note, the keyword slug in the view name, it must exist in the pages data and no special considerations will be given to it, slugs should be different from each other. See docs for more.

### Tokens

Jampass looks at file names for clues on how to handle a file.

- "-" dash/loop token (only considered if the first character of a file name)
- "_" undercore/slash token (only considered if inside dynamic key tokens)
- "[" and "]" dynamic keys tokens (enclose dynamic keys that will be read from funneled data), for example a slug.

See docs for more.

### Special names

- (*some asset*.**static**.*some ext*) outputs some static asset
- (*ISO locale name*.**locale.json**) outputs some locale

## Development environment

Jampass provides users with a modern platorm to develop with. Latest JS support with [esbuild](https://esbuild.github.io/). Latest CSS with [postcss](https://postcss.org/) and optional templating with [consolidate.js](https://www.npmjs.com/package/consolidate)

## Demos

Take a look at the [demos](./demos/) directory for practical examples.

## View engine

Jampass comes out of the box with support for [handlebars](https://www.npmjs.com/package/handlebars). With additional support for any templating engine [consolidate.js](https://www.npmjs.com/package/consolidate) supports.


## Author

(c) 2021 Simao Nziaka
