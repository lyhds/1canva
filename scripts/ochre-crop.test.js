import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const python = process.env.CANVASRA_PYTHON || '.shopify/canvasra-python/bin/python';
const available = spawnSync(python, ['-c', 'import PIL']).status === 0;
test('detail crop preserves pixels, records provenance and rejects bounds/overwrite', { skip: available ? false : 'Set up isolated Pillow environment per CODEX_PRODUCT_WORKFLOW.md' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvasra-crop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'master.png'), output = path.join(dir, 'detail.png');
  assert.equal(spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.new("RGB",(10,10),(50,80,120)).save(sys.argv[1])', source]).status, 0);
  const run = (...box) => spawnSync(python, ['scripts/ochre-crop.py', source, output, ...box.map(String)], { encoding: 'utf8' });
  assert.equal(run(8, 8, 5, 5).status, 1);
  assert.ok(!fs.existsSync(output));
  assert.equal(run(1, 2, 4, 5).status, 0);
  const sidecar = JSON.parse(fs.readFileSync(output + '.json'));
  assert.deepEqual(sidecar.box, [1, 2, 4, 5]);
  assert.match(sidecar.sourceSHA256, /^[a-f0-9]{64}$/);
  assert.equal(spawnSync(python, ['-c', 'from PIL import Image; import sys; im=Image.open(sys.argv[1]); assert im.size==(4,5); assert im.getpixel((0,0))==(50,80,120)', output]).status, 0);
  assert.equal(run(1, 2, 4, 5).status, 1);
});
