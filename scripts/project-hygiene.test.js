import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

test('legacy product creation and size mutation require explicit opt-in before reading credentials', () => {
  for (const [file,args] of [
    ['create-product.js',['--dir','missing-fixture','--title','Test','--master','missing.jpg']],
    ['migrate-size-values.js',['--apply']],
  ]) {
    const result=spawnSync(process.execPath,[`scripts/${file}`,...args],{encoding:'utf8',env:{}});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Legacy .*blocked/);
    assert.doesNotMatch(result.stderr,/SHOPIFY_CLIENT|ENOENT|token/i);
  }
});

test('package commands use pnpm and do not expose unrestricted theme uploads', () => {
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.match(pkg.packageManager,/^pnpm@/);
  assert.equal(pkg.scripts.verify,'pnpm check && pnpm test');
  assert.equal(pkg.scripts.push,undefined);
  assert.equal(pkg.scripts.pull,undefined);
  assert.ok(fs.existsSync('pnpm-lock.yaml'));
  assert.ok(!fs.existsSync('package-lock.json'));
});

test('theme upload ignores credentials, local state and developer files', () => {
  const rules=fs.readFileSync('.shopifyignore','utf8').split(/\r?\n/);
  for(const entry of ['.env','.env.*','.shopify/','scripts/','docs/','pnpm-lock.yaml','pnpm-workspace.yaml']) assert.ok(rules.includes(entry),entry);
});
