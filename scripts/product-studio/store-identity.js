import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './store.js';

// Single source of truth for store identity. Nothing may hardcode a storefront
// host: the same code has to run against a development store and production.
// Values come from process.env first, then are overridden by the repository .env
// file, matching the precedence the Shopify client has always used.
export const DEFAULT_STOREFRONT_HOST = 'canvasra.com';
export const DEFAULT_CURRENCY = 'USD';

export function envMap() {
  const values = {...process.env};
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) values[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return values;
}

export function storefrontHost() {
  return (envMap().SHOPIFY_STOREFRONT_HOST || DEFAULT_STOREFRONT_HOST).trim().toLowerCase();
}

export function currencyCode() {
  return (envMap().SHOPIFY_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();
}

export function storefrontUrl() {
  return `https://${storefrontHost()}/`;
}

// Guards every read against pointing at the wrong shop. A mismatched host or
// currency means the credentials belong to another storefront, so stop instead
// of writing pricing or publishing products into it.
export function assertStore(shop) {
  const host = shop?.primaryDomain?.host, currency = shop?.currencyCode;
  if (host !== storefrontHost() || currency !== currencyCode()) {
    throw Error(`店铺域名或币种不匹配（期望 ${storefrontHost()} / ${currencyCode()}，实际 ${host||'未知'} / ${currency||'未知'}）`);
  }
}
