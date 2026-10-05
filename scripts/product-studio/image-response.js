import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const MAX_BYTES = 40 * 1024 * 1024;
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a > 0 && a < 224 && ![10,127].includes(a)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && [0,168].includes(b)) && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 198 && [18,19].includes(b));
  }
  // Only global IPv6 unicast; excludes loopback, local and IPv4-mapped addresses.
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}

const DOH_ENDPOINTS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];

/** Addresses that transparent proxies hand out as placeholders (Clash/Surge
 *  defaults). They are routing tokens, not destinations, so they are the only
 *  non-public answers that may be re-checked independently. A genuine private
 *  address is never treated this way. */
export function fakeProxyAddress(address) {
  if (net.isIP(address) === 4) {const [a,b] = address.split('.').map(Number);return a === 198 && (b === 18 || b === 19);}
  return net.isIP(address) === 6 && /^fdfe:dcba:9876:/i.test(address);
}

/** Independent confirmation that a hostname really maps to public addresses.
 *  The local resolver cannot tell a proxy placeholder from a real private
 *  address, so a fake-IP answer is only accepted when DNS-over-HTTPS agrees the
 *  name resolves publicly. Unreachable or disagreeing resolvers fail closed. */
export async function publicDohAddresses(host, fetcher = fetch) {
  for (const endpoint of DOH_ENDPOINTS) {
    const addresses = [];
    let complete = true;
    for (const type of ['A', 'AAAA']) {
      try {
        const response = await fetcher(`${endpoint}?name=${encodeURIComponent(host)}&type=${type}`, {
          headers: {Accept: 'application/dns-json'}, redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {complete = false;break;}
        const payload = await response.json();
        if (payload?.Status !== 0) {complete = false;break;}
        for (const answer of payload.Answer || []) if (answer.type === 1 || answer.type === 28) addresses.push(String(answer.data));
      } catch {complete = false;break;}
    }
    if (complete && addresses.length && addresses.every(address => net.isIP(address) && publicAddress(address))) return true;
  }
  return false;
}

export function downloadResultImage(value, {get = https.get, lookup = dns.lookup, verifyHost = publicDohAddresses} = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || host === 'localhost' || (net.isIP(host) && !publicAddress(host))) {
      reject(Error('Invalid image URL'));return;
    }
    // Resolve and validate at the actual socket lookup, avoiding a DNS check/use gap.
    const safeLookup = (hostname, options, callback) => lookup(hostname, {all:true}, (error, addresses) => {
      if (error || !addresses?.length) {callback(Error('Image host must be public'));return;}
      const resolved = () => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
      const rejected = () => callback(Error('Image host must be public'));
      if (addresses.every(a => publicAddress(a.address))) {resolved();return;}
      // Only placeholder answers may be re-checked; anything else stays rejected
      // so a mixed public/private answer can never reach a private destination.
      const placeholderOnly = addresses.every(a => publicAddress(a.address) || fakeProxyAddress(a.address))
        && addresses.some(a => fakeProxyAddress(a.address));
      if (!placeholderOnly) {rejected();return;}
      Promise.resolve().then(() => verifyHost(hostname)).then(ok => ok ? resolved() : rejected(), rejected);
    });
    // No API credentials or cookies are ever sent to image/CDN URLs.
    const request = get(url, {headers:{Accept:'image/*'}, lookup:safeLookup, signal:AbortSignal.timeout(60000)}, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) {reject(Error('Image redirect failed'));return;}
        let next;try {next = new URL(response.headers.location, url).href;}catch {reject(Error('Invalid redirect'));return;}
        downloadResultImage(next, {get,lookup,verifyHost}, redirects + 1).then(resolve,reject);return;
      }
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_BYTES) {
        response.resume();reject(Error('Image download rejected'));return;
      }
      const chunks=[];let size=0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {response.destroy();reject(Error('Image too large'));return;}
        chunks.push(chunk);
      });
      response.on('end', () => size ? resolve(Buffer.concat(chunks)) : reject(Error('Empty image')));
      response.on('error', reject);
      response.on('aborted', () => reject(Error('Image download interrupted')));
    });
    request.on('error', reject);
  });
}

export async function imageBytes(response, download = downloadResultImage) {
  const item = response?.data?.[0];
  if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
    const encoded=item.b64_json.replace(/\s/g,'');
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('Invalid image data');
    return Buffer.from(encoded,'base64');
  }
  if (typeof item?.url === 'string' && item.url) return download(item.url);
  throw Error('Missing image result');
}

// Target a 2K long edge. Larger sizes were tried on 2026-09-10 and reverted: at a
// 2880 long edge a 1:1 master produced a 22.4 MB lossless PNG (Shopify rejects media
// over 20 MB) and the inline base64 response grew enough that one scene was generated,
// billed and then lost to a broken transfer. At 2K the heaviest asset (1:1, 2048x2048)
// is about 11 MB and a scene takes roughly half the generation time.
//
// Both ceilings stay in place: the pixel budget does not bind at 2K, but it protects
// the 20 MB ceiling if the long edge is ever raised again.
export const EDIT_TARGET_LONG_EDGE = 2048;
export const EDIT_MAX_PIXELS = 6_000_000;
export function editSize(model, ratio) {
  // Version families of the same endpoint (2, 2.5, 2-vip) all take an explicit size.
  if (!/^gpt-image-2(?:[.-]|$)/i.test(model)) return 'auto';
  const [width,height] = ratio.split(':').map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw Error('无效的生成比例');
  // Exact ratio; both dimensions must be multiples of 16.
  const byLongEdge = Math.floor(EDIT_TARGET_LONG_EDGE / (Math.max(width,height) * 16)) * 16;
  const byPixelBudget = Math.floor(Math.sqrt(EDIT_MAX_PIXELS / (width * height)) / 16) * 16;
  const unit = Math.max(16, Math.min(byLongEdge, byPixelBudget));
  return `${width * unit}x${height * unit}`;
}
