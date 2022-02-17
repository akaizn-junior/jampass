import { isObj } from './helpers.js';

const keep = {};

export function add(name, value = {}) {
  if (!keep[name]) keep[name] = isObj(value) ? value : {};
}

export function upsert(name, value = {}) {
  keep[name] = isObj(value)
    ? Object.assign(keep[name] || {}, value) : {};
}

export function peek(at = 0) {
  return Object.entries(keep)[at];
}

export function get(name) {
  return keep[name];
}

export function appendHtmlTo(to, name, data) {
  const item = keep[to];
  if (item && !item[name]) {
    keep[to][name] = data;
    return item;
  }

  return null;
}

export function appendAssetsTo(to, assets) {
  const item = keep[to];

  if (item) {
    item.assets = assets;
    const assetList = Object.values(assets)
      .reduce((acc, list) => acc.concat(list), []);

    for (const asset of assetList) {
      if (!item[asset.from]) {
        // add asset data straight to the object
        keep[to][asset.from] = {
          ...asset
        };
      }

      if (!keep[asset.from]) {
        // this asset points back to objects that include it
        keep[asset.from] = {
          ...asset,
          htmls: [to]
        };
      } else if (!keep[asset.from].htmls.includes(to)) {
        // append new generated html to the list of htmls
        // that link this asset
        keep[asset.from].htmls.push(to);
      }
    }

    return item;
  }

  return null;
}
