import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './product-studio/store.js';
import { createApp } from './product-studio/server.js';
import { SCENE_STYLES, listSceneStyles, getSceneStyle, assertSceneStyle, styleDirectionClause, styleSelectionClause, styleFidelityClause } from './product-studio/scene-styles.js';
import { directionPrompt } from './product-studio/art-direction.js';
import { composedPrompt, bakedFramePrompt } from './product-studio/composed-scene.js';

test('style presets are complete and expose only safe fields to the browser', () => {
  assert.ok(SCENE_STYLES.length >= 4, 'a meaningful preset list');
  assert.equal(new Set(SCENE_STYLES.map(s => s.id)).size, SCENE_STYLES.length, 'unique ids');
  for (const s of SCENE_STYLES) {
    for (const key of ['id', 'label', 'summary', 'directive', 'seek', 'avoid'])
      assert.ok(typeof s[key] === 'string' && s[key].trim(), `${s.id} missing ${key}`);
    assert.match(s.id, /^[a-z0-9-]+$/, 'url- and json-safe id');
  }
  const listed = listSceneStyles();
  assert.equal(listed.length, SCENE_STYLES.length);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['id', 'label', 'summary'], 'prompt internals stay server-side');
});

test('job creation stores a validated style and rejects unknown ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvasra-styles-'));
  try {
    const store = new Store(dir);
    assert.equal(store.create({}).sceneStyle, '', 'default stays automatic');
    assert.equal(store.create({ sceneStyle: 'bright-minimal' }).sceneStyle, 'bright-minimal');
    assert.equal(store.create({ sceneStyle: '  ' }).sceneStyle, '', 'blank means automatic');
    assert.throws(() => store.create({ sceneStyle: 'neon-cyberpunk' }), /未知的场景风格/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('clauses are empty without a selection and fully spelled out with one', () => {
  assert.equal(getSceneStyle('nope'), null);
  assert.equal(assertSceneStyle(undefined), '');
  for (const fn of [styleDirectionClause, styleSelectionClause, styleFidelityClause]) {
    assert.equal(fn({}), '');
    assert.equal(fn({ sceneStyle: 'unknown' }), '');
  }
  const job = { sceneStyle: 'dark-gallery' };
  assert.match(styleDirectionClause(job), /MANDATORY/);
  assert.match(styleDirectionClause(job), /深色画廊/);
  assert.match(styleDirectionClause(job), /stay inside this style family/);
  assert.match(styleSelectionClause(job), /dark charcoal or ink walls/);
  assert.match(styleSelectionClause(job), /bright airy white rooms/);
  assert.match(styleSelectionClause(job), /Style fit outranks palette matching/);
  assert.match(styleFidelityClause(job), /Stay close to image 1's furniture style, materials and palette/);
  assert.match(styleFidelityClause(job), /recognizably the reference's room/);
});

test('art direction prompt: style constrains the plan, brief survives as notes', () => {
  const base = { analysis: { ratio: '1:1', palette: 'warm' }, sceneWorkflow: 'baked-frames-v1', pricing: { variants: [{ frame: 'Oak Float Frame', availableForSale: true }] } };
  const automatic = directionPrompt(base);
  assert.match(automatic, /User styling preferences: Choose from the artwork itself\./);
  assert.doesNotMatch(automatic, /MANDATORY/);
  const styled = directionPrompt({ ...base, sceneStyle: 'bright-minimal', sceneBrief: 'avoid rugs' });
  assert.match(styled, /User-selected room style \(MANDATORY/);
  assert.match(styled, /明亮极简白/);
  assert.match(styled, /Additional free-text notes from the user: avoid rugs\./);
  assert.doesNotMatch(styled, /Choose from the artwork itself/);
});

test('generation prompt follows the reference only when a style is chosen', () => {
  const base = { analysis: { ratio: '1:1', palette: 'warm' } };
  const automatic = composedPrompt(base, 'scene-1', '4:5');
  assert.match(automatic, /Room reference cues may be adapted; image 2 artwork must not be redesigned\./);
  const styledJob = { ...base, sceneStyle: 'warm-wood' };
  for (const build of [composedPrompt, bakedFramePrompt]) {
    for (const slot of ['scene-1', 'scene-2', 'scene-3', 'scene-desktop']) {
      const prompt = build(styledJob, slot, slot === 'scene-desktop' ? '21:9' : '4:5');
      assert.match(prompt, /Stay close to image 1's furniture style, materials and palette/, build.name + ' ' + slot);
      assert.match(prompt, /暖调木色/);
      assert.doesNotMatch(prompt, /cues may be adapted/, build.name + ' ' + slot);
      assert.match(prompt, /image 2 artwork must not be redesigned/);
    }
  }
});

test('bootstrap hands the preset list to the browser without credentials', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvasra-styles-boot-'));
  const store = new Store(dir);
  const app = createApp({ store, shopify: { configured: () => false }, pipeline: { recover() {}, tick() {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => app.server.close(r)));
  try {
    const body = await (await fetch('http://127.0.0.1:' + app.server.address().port + '/api/bootstrap')).json();
    assert.ok(Array.isArray(body.styles) && body.styles.length === SCENE_STYLES.length);
    assert.deepEqual(Object.keys(body.styles[0]).sort(), ['id', 'label', 'summary']);
    assert.ok(!JSON.stringify(body).includes('SECRET'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
