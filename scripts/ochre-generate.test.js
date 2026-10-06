import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execute } from './ochre-workflow.js';

const REPO = path.resolve(import.meta.dirname, '..');
const RELATIVE_IMPORT = /(?:^|\n)\s*import[^'"]*['"]([^'"]+)['"]/g;

/**
 * The workflow is spawned from an isolated copy so a run can never read the
 * repository .env or write into its state directory. Two properties matter:
 * the copy carries the whole relative import graph (the workflow pulls store
 * identity in, which in turn pulls the store module graph), and it lives inside
 * the checkout so bare dependencies such as sharp still resolve from the
 * repository node_modules. The scratch parent is gitignored.
 */
function isolatedRoot() {
  const scratch = path.join(REPO, '.shopify', 'tmp');
  fs.mkdirSync(scratch, { recursive: true });
  return fs.mkdtempSync(path.join(scratch, 'canvasra-generation-'));
}

function copyImportGraph(root, entries) {
  const copied = new Set();
  const copy = source => {
    const absolute = path.resolve(source);
    if (copied.has(absolute)) return;
    copied.add(absolute);
    const target = path.join(root, path.relative(REPO, absolute));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(absolute, target);
    const text = fs.readFileSync(absolute, 'utf8');
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(absolute), spec);
      copy(fs.existsSync(base) ? base : `${base}.js`);
    }
  };
  for (const entry of entries) copy(path.join(REPO, entry));
}

for (const provider of ['openrouter', 'custom-api', 'codex']) for (const uncertain of [false, true]) test(`${provider} generation ${uncertain ? 'timeout is uncertain' : 'saves response and actual cost'} without retry`, t => {
  const root = isolatedRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  copyImportGraph(root, ['scripts/ochre-workflow.js', 'scripts/ochre-generate.js']);
  const base = path.join(root, '.shopify/canvasra-workflow');
  execute(base, 'init', 'test');
  const config = path.join(root, 'request.json');
  fs.writeFileSync(config, JSON.stringify({ ...(provider === 'openrouter' ? {} : { provider, endpoint: 'https://images.example.test/generate', apiKeyEnv: 'CUSTOM_IMAGE_KEY' }), model: provider === 'openrouter' ? 'x-ai/test' : 'custom-model', prompt: 'fixture', resolution: '1K', aspect_ratio: '1:1', references: [] }));
  const calls = path.join(root, 'calls');
  const endpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/images' : 'https://images.example.test/generate';
  const mock = `import fs from 'node:fs'; import assert from 'node:assert/strict'; globalThis.fetch = async (url,options) => { assert.equal(url,${JSON.stringify(endpoint)}); assert.equal(options.headers.Authorization,'Bearer fake-test-secret'); assert.equal(options.redirect,'error'); fs.appendFileSync(${JSON.stringify(calls)},'1'); ${uncertain ? "throw Error('timeout')" : "return new Response(JSON.stringify({data:[{media_type:'image/png',b64_json:'aW1hZ2U='}],usage:{cost:0.04}}),{status:200})"}; };`;
  const run = () => spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, path.join(root, 'scripts/ochre-generate.js'), 'test', 'master-1', config, 'Authorized fixture'], { encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: 'fake-test-secret', CUSTOM_IMAGE_KEY: 'fake-test-secret' } });
  const result = run();
  if (provider === 'codex') {
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(calls), false);
    assert.deepEqual(execute(base, 'status', 'test').operations, {});
    return;
  }
  assert.equal(result.status, uncertain ? 1 : 0, result.stderr);
  const state = execute(base, 'status', 'test');
  assert.equal(state.operations['master-1'].status, uncertain ? 'uncertain' : 'complete');
  if (!uncertain) assert.equal(state.operations['master-1'].receipt.costUSD, 0.04);
  if (!uncertain) assert.equal(state.operations['master-1'].receipt.provider, provider);
  assert.equal(run().status, 1);
  assert.equal(fs.readFileSync(calls, 'utf8'), '1');
  assert.doesNotMatch(result.stdout + result.stderr, /fake-test-secret/);
});
