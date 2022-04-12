# TODO

- [] check if postcss handles css imports, must process css imported files as well. note https://www.npmjs.com/package/get-css-data

- [x] reajust line numbers in html css error, currently the lines are based on the css read and not the whole html file

- [x] improve code snippet styling (phase 1)

- [x] include better js handling

- [x] add search index build

- [x] add pagination

- [x] maybe include bytes formatter like 1000 bytes = 1kb

- [x] fix css from html snippet line numbers (not needed)

- [] improve cheerio formating for replacing a node in the code

- [x] add object to object pagination

- [] add filters through 'custom' keys or filters and custom keys

- [x] improve view engine error handling

- [] partials edits should only trigger a build if they are used (seems tough)

- [] provide current page for pagination

- [x] improve search logic / consider using lunr.js / https://lunrjs.com/guides/core_concepts.html (DO NOT INCLUDE SEARCH FEATURE, DO BUILD INDEXES THO)

- [] fix serve error when using bad source folder (recreate and fix)

- [] improve watch funnel for regenerating pages on funnel changes

- [] improve watch mode in production env (fix watch when names have hashes)

- [] watch static assets

- [] play with htmlvalidate json, and see how to properly implement it

- [x] read env as cli option

- [x] for development mode static asssets should be symlinks, so changes affect the output

- [] rebuild source, if output dir is deleted on watch mode

- [] notify user about linking a static asset to html, did they really mean to do it.
static assets are not transformed, regular assets are, so a linked static asset is transformed,
user may not want this behaviour
