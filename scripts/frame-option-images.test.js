import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const section = fs.readFileSync('sections/main-product.liquid', 'utf8');
const mapping = fs.readFileSync('snippets/frame-option-image.liquid', 'utf8');

test('desktop and mobile frame options share the same thumbnail mapping', () => {
  assert.equal((section.match(/render 'frame-option-image', frame: value/g) || []).length, 2);
  assert.ok(!section.includes("render 'frame-swatch', frame: value"));
  for (const filename of mapping.match(/[a-z-]+\.(?:webp|svg)/g)) {
    assert.ok(fs.existsSync(`assets/${filename}`), filename);
  }
});

test('mobile frame options distinguish all three delivery states and selected thumbnail', () => {
  for (const key of ['rolled_delivery', 'stretched_delivery', 'framed_delivery']) {
    assert.ok(section.includes(`products.product.${key}`));
    const locale = fs.readFileSync('locales/en.default.json', 'utf8');
    assert.ok(locale.includes(`"${key}":`));
  }
  assert.ok(section.includes('group-aria-pressed/frame:border-black'));
});
