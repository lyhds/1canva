#!/usr/bin/env node
// Cold-start baseline for a brand-new storefront.
//
// Why this exists: the Studio pipeline refuses to price a product until
// resolveStoreRules() can resolve, for the artwork's ratio, (a) exactly one
// [RATIO DRAFT] template product and (b) an ACTIVE reference product covering
// every one of that template's variants. A store with zero products has
// neither, so the very first product can never be created — the pipeline stops
// at its "读取店铺规则" step. These two assets are store-side records, not code,
// so nothing in the repository can supply them; a migrated store brought them
// along with its catalogue, a fresh store has to lay them down.
//
// This one-off script derives them from the local price catalogue:
//   - one DRAFT template per ratio, zero-priced, one variant per Size x Frame
//   - one ACTIVE reference per ratio, non-zero priced, inventory untracked so
//     the variant is sellable without allocated stock
//
// Nothing is published to any sales channel. The references are ACTIVE (which
// is what the rule check requires) but stay off the storefront, so shoppers
// never see them.
//
// Default is a read-only plan. Nothing is written without --apply.
//
//   node scripts/bootstrap-store-baseline.js                # plan only
//   node scripts/bootstrap-store-baseline.js --ratio=3:4    # plan a single ratio
//   node scripts/bootstrap-store-baseline.js --apply        # create the missing ones
//
// Re-running is safe: an asset already present under the same handle is left
// untouched, so the script only ever creates what is missing.

import {Shopify} from './product-studio/shopify.js';
import {catalogReference} from './product-studio/catalog-reference.js';
import {assertStore, storefrontHost, currencyCode} from './product-studio/store-identity.js';
import {storeRatios} from './product-studio/rules.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyRatio = args.find(a => a.startsWith('--ratio='))?.slice('--ratio='.length);
const TAG = 'canvasra-baseline';
const FRAMES = Object.keys(catalogReference.frames);
// Non-zero, sellable price for the references. Only the reference's inventory
// rules are copied downstream; creation prices always come from the table.
const REFERENCE_PRICE_FRAME = 'Rolled Canvas';

if (onlyRatio && !storeRatios.includes(onlyRatio)) {
  console.error(`--ratio 只支持 ${storeRatios.join(' / ')}`);
  process.exit(1);
}
const ratios = onlyRatio ? [onlyRatio] : storeRatios;

const slug = ratio => ratio.replace(':', '-');
const templateTitle = ratio => `[RATIO DRAFT] ${ratio} baseline template`;
const referenceTitle = ratio => `[RATIO BASELINE] ${ratio} baseline reference`;
const handleOf = (kind, ratio) => `${kind}-${slug(ratio)}-baseline-${kind === 'ratio-draft' ? 'template' : 'reference'}`;

// Zero-priced DRAFT scaffolding. The pipeline only reads the Size x Frame
// combination list from it, so every price stays at 0.00 and the product must
// never be published or repriced.
function templateInput(ratio, sizes) {
  return {
    title: templateTitle(ratio),
    handle: handleOf('ratio-draft', ratio),
    status: 'DRAFT',
    productType: 'Painting',
    tags: [TAG, 'ratio-' + slug(ratio)],
    descriptionHtml:
      '<p>Store-side scaffolding for the Canvasra product pipeline. ' +
      `Declares the ${ratio} size and finish combinations the pricing rule check ` +
      'reads before any product can be created. Not a product for sale.</p>',
    productOptions: [
      {name: 'Size', position: 1, values: sizes.map(s => ({name: s.label}))},
      {name: 'Frame', position: 2, values: FRAMES.map(name => ({name}))},
    ],
    variants: sizes.flatMap(size =>
      FRAMES.map(frame => ({
        optionValues: [
          {optionName: 'Size', name: size.label},
          {optionName: 'Frame', name: frame},
        ],
        price: '0.00',
        inventoryPolicy: 'CONTINUE',
        inventoryItem: {tracked: false, requiresShipping: true},
      })),
    ),
  };
}

// ACTIVE reference. Its per-variant sellable state, inventory policy and
// shipping flag are copied into every future product of this ratio; its prices
// are not. Untracked inventory keeps every variant available without stock.
function referenceInput(ratio, sizes) {
  return {
    title: referenceTitle(ratio),
    handle: handleOf('ratio-baseline', ratio),
    status: 'ACTIVE',
    productType: 'Painting',
    tags: [TAG, 'ratio-' + slug(ratio)],
    descriptionHtml:
      '<p>Store-side baseline reference for the Canvasra product pipeline. ' +
      `Supplies the sellable state, inventory policy and shipping rules for every ` +
      `${ratio} size and finish combination. Kept off all sales channels; ` +
      'not a product for sale.</p>',
    productOptions: [
      {name: 'Size', position: 1, values: sizes.map(s => ({name: s.label}))},
      {name: 'Frame', position: 2, values: FRAMES.map(name => ({name}))},
    ],
    variants: sizes.flatMap(size =>
      FRAMES.map(frame => ({
        optionValues: [
          {optionName: 'Size', name: size.label},
          {optionName: 'Frame', name: frame},
        ],
        price: size.prices[frame],
        inventoryPolicy: 'CONTINUE',
        inventoryItem: {tracked: false, requiresShipping: true},
      })),
    ),
  };
}

const CREATE = `mutation($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id title handle status }
    userErrors { message }
  }
}`;

async function main() {
  const shopify = new Shopify();
  if (!shopify.configured()) {
    console.error('缺少 .env：需要 SHOPIFY_STORE、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET。');
    process.exit(1);
  }

  const shop = (await shopify.gql('query { shop { name primaryDomain { host } currencyCode } }')).shop;
  assertStore(shop);

  console.log(`店铺        : ${shop.primaryDomain.host} (${shop.currencyCode})`);
  console.log(`期望守卫    : ${storefrontHost()} / ${currencyCode()}`);
  console.log(`价表版本    : ${catalogReference.version} · ${FRAMES.length} 种装裱`);
  console.log(`模式        : ${APPLY ? 'APPLY（会写入店铺）' : 'DRY RUN（只读，不写入）'}`);
  console.log('');

  const found = (await shopify.gql(
    `query($q: String!) { products(first: 100, query: $q) { nodes { id title handle status } } }`,
    {q: `tag:${TAG}`},
  )).products.nodes;
  const byHandle = new Map(found.map(p => [p.handle, p]));

  const work = [];
  for (const ratio of ratios) {
    const sizes = catalogReference.profiles[ratio] || [];
    if (!sizes.length) throw Error(`价表缺少比例 ${ratio} 的尺寸`);
    for (const [kind, title, build] of [
      ['ratio-draft', templateTitle(ratio), templateInput],
      ['ratio-baseline', referenceTitle(ratio), referenceInput],
    ]) {
      const handle = handleOf(kind, ratio);
      const existing = byHandle.get(handle);
      work.push({
        ratio,
        kind,
        title,
        handle,
        variants: sizes.length * FRAMES.length,
        sizes: sizes.length,
        existing,
        input: existing ? null : build(ratio, sizes),
      });
    }
  }

  console.log('计划：');
  console.log('  比例   尺寸  变体   草稿模板                在售参照');
  for (const ratio of ratios) {
    const sizes = (catalogReference.profiles[ratio] || []).length;
    const t = work.find(w => w.ratio === ratio && w.kind === 'ratio-draft');
    const r = work.find(w => w.ratio === ratio && w.kind === 'ratio-baseline');
    const mark = w => (w.existing ? `已存在(${w.existing.status})` : '待创建');
    console.log(
      `  ${ratio.padEnd(6)} ${String(sizes).padStart(4)} ${String(sizes * FRAMES.length).padStart(5)}   ${mark(t).padEnd(22)} ${mark(r)}`,
    );
  }
  const todo = work.filter(w => !w.existing);
  console.log('');
  console.log(`新建 ${todo.length} 件 / 已存在 ${work.length - todo.length} 件（共 ${work.length} 件基准资产）`);

  if (!APPLY) {
    console.log('');
    console.log('DRY RUN 结束。加 --apply 执行写入。');
    return;
  }
  if (!todo.length) {
    console.log('没有需要创建的资产。');
  }

  const created = [];
  for (const item of todo) {
    const r = await shopify.gql(CREATE, {input: item.input});
    const p = r.productSet.product;
    created.push({...item, id: p.id});
    console.log(`  已创建 ${p.status.padEnd(6)} ${p.handle}  ${p.id}`);
  }

  // Read the result back through the same resolver the pipeline uses, so the
  // report reflects the actual rule state rather than an assumption.
  console.log('');
  console.log('核对（用流水线同一套解析逻辑）：');
  const catalog = await shopify.catalog();
  const rules = await shopify.rules(catalog, {}, ratios);
  for (const row of rules.rows) {
    const detail = row.status === 'ready'
      ? `${row.sizeCount} 尺寸 · ${row.variantCount} 组合 · 参照「${row.referenceTitle}」`
      : row.error;
    console.log(`  ${row.ratio.padEnd(6)} ${row.status === 'ready' ? '✓' : '✗'} ${detail}`);
  }
  const ready = rules.rows.filter(r => r.status === 'ready').length;
  console.log('');
  console.log(`就绪 ${ready} / ${rules.rows.length} 种比例。`);

  // The forward lock: a pipeline can only price a ratio once the reference
  // reports as sellable. If Shopify counts an unpublished ACTIVE product as
  // unavailable, this is where it shows up.
  const refs = created.filter(c => c.kind === 'ratio-baseline');
  for (const ref of refs) {
    const p = await shopify.pricingProduct(ref.id);
    const dead = p.variants.nodes.filter(v => !v.availableForSale);
    console.log(
      `  参照 ${(ref.ratio + '        ').slice(0, 6)} ${p.variants.nodes.length} 个变体，不可售 ${dead.length} 个` +
        (dead.length ? ` ✗ 需发布到某个渠道后重跑` : ' ✓'),
    );
  }
}

await main();
