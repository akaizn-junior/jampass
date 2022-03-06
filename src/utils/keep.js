import { isObj } from './helpers.js';

const keep = {};

export function add(name, value = {}) {
  if (!keep[name]) keep[name] = isObj(value) ? value : {};
}

export function upsert(name, value = null) {
  keep[name] = isObj(value) ? value : {};
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

export function appendAssetTo(to, asset) {
  const item = keep[to];

  if (item) {
    if (!item.assets) {
      keep[to].assets = [asset];
    } else {
      keep[to].assets.push(asset);
    }

    if (!item[asset.from]) {
      // add asset data straight to the object
      keep[to][asset.from] = {
        ...asset
      };
    }

    return item;
  }

  return null;
}
