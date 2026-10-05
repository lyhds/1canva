import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { execute } from './ochre-workflow.js';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'canvasra-workflow-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = (cmd, ...args) => execute(base, cmd, 'painting', args);
  const json = (name, data) => { const file = path.join(base, `${name}.json`); fs.writeFileSync(file, JSON.stringify(data)); return file; };
  const image = path.join(base, 'sample.png');
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
  fs.writeFileSync(image + '.json', JSON.stringify({ method: 'crop', sourceSHA256: sha, outputSHA256: sha, box: [0, 0, 1, 1] }));
  run('init');
  return { base, run, json, image };
}
function ready(f) {
  f.run('spec', f.json('spec', { ratio: '4:3', mode: 'create', rightsConfirmed: true, textureDecision: 'omit', textureReason: 'Smooth', productionConfirmed: true }));
  for (const slot of ['master', 'detail', 'scene-1', 'scene-2', 'scene-3']) {
    const v = f.run('import', slot, f.image, slot === 'detail' ? 'crop' : slot.startsWith('scene') ? 'scene-room-v1' : 'generated');
    f.run('accept', v.latestVersion, 'Test user approved');
  }
  for (const doc of ['rules', 'copy']) f.run('document', doc, f.json(doc, { fixture: true }));
  f.run('document', 'pricing', f.json('pricing', { currency: 'USD', confirmed: true, rounding: 'cent', referenceProductIds: ['fixture'], variants: [{ size: '40 × 30 cm', frame: 'Oak Float Frame', priceCents: 10500 }] }));
}

test('task IDs cannot escape state directory and initialization never overwrites', t => {
  const f = fixture(t);
  assert.throws(() => execute(f.base, 'init', '../bad'), /Task id/);
  assert.throws(() => f.run('init'), /already exists/);
});
test('master acceptance invalidates downstream and stale versions cannot be accepted', t => {
  const f = fixture(t); ready(f);
  const old = f.run('status').accepted.detail;
  const next = f.run('import', 'master', f.image, 'generated');
  f.run('accept', next.latestVersion, 'New master accepted');
  assert.deepEqual(Object.keys(f.run('status').accepted), ['master']);
  assert.throws(() => f.run('accept', old, 'Old'), /old master/);
});
test('approval binds exact reviewed content and tampering blocks external writes', t => {
  const f = fixture(t); ready(f);
  const state = f.run('status');
  assert.deepEqual(state.blockers, []);
  assert.throws(() => f.run('approve', 'wrong', 'User approved'), /digest changed/);
  f.run('approve', state.digest, 'User approved publication');
  const master = state.versions.find(v => v.id === state.accepted.master);
  fs.appendFileSync(path.join(f.base, 'painting', master.file), 'changed');
  assert.throws(() => f.run('begin', 'create-draft', 'shopify', 'User approved'), /fully reviewed/);
});
test('pending/uncertain generation cannot be duplicated and mutation is blocked until reconciliation', t => {
  const f = fixture(t);
  f.run('begin', 'master-1', 'generation', 'One paid request approved');
  assert.throws(() => f.run('begin', 'master-2', 'generation', 'Retry'), /pending/);
  assert.throws(() => f.run('import', 'master', f.image, 'generated'), /pending/);
  f.run('finish', 'master-1', f.json('uncertain', { status: 'uncertain', evidence: 'Timed out' }));
  assert.throws(() => f.run('begin', 'master-2', 'generation', 'Retry'), /pending/);
  f.run('finish', 'master-1', f.json('resolved', { status: 'complete', evidence: 'Retrieved existing output' }));
  assert.throws(() => f.run('begin', 'master-1', 'generation', 'Retry'), /exists/);
});
test('zero price blocks approval, and document changes clear approval', t => {
  const f = fixture(t); ready(f);
  f.run('approve', f.run('status').digest, 'Approved');
  f.run('document', 'pricing', f.json('bad', { currency: 'USD', variants: [{ size: 'x', frame: 'y', priceCents: 0 }] }));
  assert.equal(f.run('status').approval, undefined);
  assert.throws(() => f.run('approve', f.run('status').digest, 'Approved'), /Invalid/);
});
test('publish receipt requires readback and binds a permanent product ID', t => {
  const f = fixture(t); ready(f);
  f.run('approve', f.run('status').digest, 'Approved');
  f.run('begin', 'create-draft', 'shopify', 'Approved');
  f.run('finish', 'create-draft', f.json('draft', { status: 'complete', evidence: 'Draft readback', productId: 'gid://shopify/Product/123' }));
  f.run('begin', 'publish', 'shopify', 'Approved');
  assert.throws(() => f.run('finish', 'publish', f.json('bad-publish', { status: 'complete', evidence: 'Response only', published: true })), /readback/);
  f.run('finish', 'publish', f.json('published', { status: 'complete', evidence: 'Remote and storefront verified', published: true, readbackVerified: true }));
  assert.ok(f.run('status').published);
  assert.throws(() => f.run('import', 'master', f.image, 'generated'), /immutable/);
});
test('CLI help is offline and generation refuses missing credentials without creating a task', () => {
  const help = spawnSync(process.execPath, ['scripts/ochre-workflow.js', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  const generation = spawnSync(process.execPath, ['scripts/ochre-generate.js', 'fixture', 'request', 'missing.json', 'test'], { encoding: 'utf8', env: {} });
  assert.equal(generation.status, 1);
  assert.match(generation.stderr, /configuration is invalid or unavailable/);
});
