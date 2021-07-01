const p = require('p-event');
const minify = require('html-minifier').minify;
const htmlParser = require('node-html-parser');

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const EOL = require('os').EOL;

const util = require('./util');

// TOKENS

const STRING_START_TOKEN = '%';
const STRING_QUOTES_TOKEN = '"';
// const STRING_BLOCK_START_TOKEN = '{';
// const STRING_BLOCK_END_TOKEN = '}';
// const keywords = [
//   'for'
// ];

const validTokRegex = new RegExp(`${STRING_START_TOKEN}`, 'gm');

// end TOKENS

function processLine(line) {
  const startTokIndex = line.indexOf(STRING_START_TOKEN);
  let code;
  const bangIndex = line.indexOf('!');
  const safeBeforeBang = Math.abs(bangIndex - 1);
  const isHtmlComment
    = safeBeforeBang < bangIndex
    && line.charAt(safeBeforeBang) === '<'
    && line.charAt(bangIndex + 1) === '-'
    && line.charAt(bangIndex + 2) === '-'
    && bangIndex < startTokIndex
  ;

  if (!isHtmlComment && startTokIndex !== -1) {
    const codeStart = startTokIndex + 2;
    const endTokIndex = line.indexOf(STRING_QUOTES_TOKEN, codeStart);
    code = line.substring(codeStart, endTokIndex);
    code = code.replace(/\s+/gm, '');
    line = line.replace(/%\s+"+/gm, '').replace(/"+/gm, '');
  }

  return {
    content: line,
    code
  };
}

async function readFile(file) {
  try {
    const result = [];
    const parsedPath = path.parse(file);
    const safeFilePath = path.join(parsedPath.dir, parsedPath.base);

    const stats = fs.statSync(safeFilePath);
    fs.accessSync(safeFilePath, fs.constants.R_OK); // no errors mean A-OK

    if (stats.isFile()) {
      const readStream = fs.createReadStream(safeFilePath);

      const reading = readline.createInterface({
        input: readStream
      });

      reading.on('line', line => result.push(processLine(line)));

      try {
        await p(reading, 'close');
        return result;
      } catch (err) {
        throw err;
      }
    }
  } catch (err) {
    throw err;
  }
}

async function compileFile(file) {
  const processed = await readFile(file);

  /**
  * @param {any} data The data to inject
  * @param {object} opts html-minifier options
  * @see [html-minifier](https://www.npmjs.com/package/html-minifier)
  */
  return (data, opts = {}) => {
    if (!data) throw Error('Data required');

    let html = '';

    for (let i = 0; i < processed.length; i++) {
      const line = processed[i];

      if (!line.code) {
        html = html.concat(line.content, EOL);
      } else {
        const property = util.accessProperty(data, line.code);
        const replaced = line.content.replace(line.code, '')
          .replace(validTokRegex, property || '');
        html = html.concat(replaced, EOL);
      }
    }

    return minify(html, opts ?? {});
  };
}

module.exports = {
  compileFile,
  accessProperty: util.accessProperty
};
