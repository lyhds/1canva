import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execute } from './ochre-workflow.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, '.shopify/canvasra-workflow');
const [id, operation, requestFile, authorization] = process.argv.slice(2);
if (!id || id === '--help') {
  console.log('Usage: node --env-file-if-exists=.env scripts/ochre-generate.js TASK OPERATION REQUEST_JSON AUTHORIZATION\nPaid operation; requires OPENROUTER_API_KEY. JSON: model, prompt, aspect_ratio, resolution, references (up to 3 local image paths). No retries.');
} else {
  let started = false;
  let receiptFile;
  try {
    const config = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    const provider = config.provider || 'openrouter';
    if (!['openrouter', 'custom-api'].includes(provider)) throw new Error('Use openrouter/custom-api here; Codex generation uses the built-in image tool and workflow begin/finish');
    const endpoint = new URL(provider === 'openrouter' ? 'https://openrouter.ai/api/v1/images' : config.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Use an HTTPS endpoint without credentials, query or fragment');
    const apiKeyEnv = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : config.apiKeyEnv;
    if (typeof apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv) || !process.env[apiKeyEnv]) throw new Error('Configure the selected API key environment variable locally');
    if (typeof config.model !== 'string' || !config.model.trim() || !config.prompt?.trim()) throw new Error('Explicit model and prompt required');
    if (!['1K', '2K'].includes(config.resolution)) throw new Error('Explicit 1K/2K resolution required');
    if (!['1:1', '3:4', '4:3', '2:3', '3:2', '2:1'].includes(config.aspect_ratio)) throw new Error('Unsupported store ratio');
    if (!Array.isArray(config.references) || config.references.length > 3) throw new Error('Provide references array (0–3 local images)');
    const provenance = [];
    const references = config.references.map(file => {
      const ext = path.extname(file).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
      if (!mime) throw new Error('Unsupported reference image type');
      const bytes = fs.readFileSync(file);
      if (bytes.length > 15 * 1024 * 1024) throw new Error('Reference exceeds local 15 MB limit');
      provenance.push({ sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } };
    });
    const body = { model: config.model, prompt: config.prompt, aspect_ratio: config.aspect_ratio, resolution: config.resolution, n: 1, ...(references.length ? { input_references: references } : {}) };
    execute(base, 'begin', id, [operation, 'generation', authorization]);
    started = true;
    const dir = path.join(base, id);
    receiptFile = path.join(dir, `${operation}-receipt.json`);
    fs.writeFileSync(path.join(dir, `${operation}-request.json`), JSON.stringify({ provider, endpoint: endpoint.href, apiKeyEnv, model: config.model, prompt: config.prompt, resolution: config.resolution, aspect_ratio: config.aspect_ratio, references: provenance }, null, 2), { flag: 'wx', mode: 0o600 });
    const response = await fetch(endpoint.href, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${process.env[apiKeyEnv]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
    });
    if (!response.ok) throw new Error(`Generation response HTTP ${response.status}; reconcile before retrying`);
    const payload = await response.json();
    const image = payload.data?.[0];
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[image?.media_type];
    if (!ext || !image?.b64_json) throw new Error('Unsupported image response; reconcile charged request');
    const output = `${operation}${ext}`;
    const bytes = Buffer.from(image.b64_json, 'base64');
    if (!bytes.length) throw new Error('Empty image response');
    fs.writeFileSync(path.join(dir, output), bytes, { flag: 'wx', mode: 0o600 });
    const receipt = { status: 'complete', evidence: 'Image API result saved; visual review still required', provider, model: config.model, output, costUSD: Number.isFinite(payload.usage?.cost) ? payload.usage.cost : null };
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
    execute(base, 'finish', id, [operation, receiptFile]);
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    if (started && receiptFile && !fs.existsSync(receiptFile)) {
      fs.writeFileSync(receiptFile, JSON.stringify({ status: 'uncertain', evidence: 'Request outcome requires manual reconciliation; no retry was performed' }), { flag: 'wx', mode: 0o600 });
      try { execute(base, 'finish', id, [operation, receiptFile]); } catch { /* pending state still blocks another call */ }
    }
    // Never echo provider response bodies, headers, URLs with credentials, or request content.
    console.error(started ? 'Generation did not finish cleanly. Inspect local operation and reconcile with provider before retrying.' : 'Generation configuration is invalid or unavailable. Check provider, HTTPS endpoint, key environment variable, model, prompt and local references.');
    process.exitCode = 1;
  }
}
