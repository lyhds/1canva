import {retailPrice,salePrice,priceTable} from './price-table.js';
import {catalogSize} from './catalog-reference.js';
import {assertStore} from './store-identity.js';
export const storeRatios = ['3:4', '2:3', '1:1', '4:3', '3:2', '2:1'];
const optionKey = v => JSON.stringify([...v.selectedOptions].sort((a, b) => a.name.localeCompare(b.name)));

export function productRatio(product) {
  const sizes = product.options?.find(o => o.name === 'Size')?.values;
  if (!sizes?.length) return null;
  return storeRatios.find(ratio => {
    const [w, h] = ratio.split(':').map(Number);
    return sizes.every(size => {
      const known=catalogSize(size);
      if(known)return known.ratio===ratio;
      const m = size.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm\b/i);
      return m && Number(m[1]) > 0 && Number(m[2]) > 0 && Math.abs(Number(m[1]) * h - Number(m[2]) * w) < .001;
    });
  }) || null;
}

export function validatePricing(template, reference, delivery, offsetKey) {
  if (!template || !reference || reference.status !== 'ACTIVE' || template.status !== 'DRAFT') throw Error('模板或定价参照状态不符合要求');
  if (template.variants.pageInfo.hasNextPage || reference.variants.pageInfo.hasNextPage) throw Error('变体超过当前单次读取上限');
  const map = new Map(reference.variants.nodes.map(v => [optionKey(v), v]));
  const variants = template.variants.nodes.filter(v => delivery !== 'framed-only' || !v.selectedOptions.some(o => o.name === 'Frame' && o.value === 'Rolled Canvas')).map(v => {
    const r = map.get(optionKey(v));
    if (!r || !r.availableForSale || !Number.isFinite(Number(r.price)) || Number(r.price) <= 0) throw Error('缺少完全匹配的可售非零参照价格');
    if (!r.inventoryItem || (r.inventoryItem.tracked && r.inventoryPolicy !== 'CONTINUE')) throw Error('库存受限变体需要实际分配库存，不能复制参照库存数量');
    const size=r.selectedOptions.find(x => x.name === 'Size')?.value,frame=r.selectedOptions.find(x => x.name === 'Frame')?.value;
    // The storewide 40%-off policy: the offset table price is the standing
    // original and is written as compareAtPrice; the selling price is 60% of it.
    const compareAtPrice=retailPrice(size,frame,offsetKey);
    return {size, frame, price:salePrice(compareAtPrice), compareAtPrice, inventoryPolicy:r.inventoryPolicy, inventoryItem:r.inventoryItem, sourceId:r.id};
  });
  if (!variants.length || variants.some(v => !v.size || !v.frame)) throw Error('尺寸或装裱选项缺失');
  return {template, reference, variants, priceTableVersion:priceTable.version};
}

// Per-product offsets intentionally vary live prices, so the signature
// compares delivery rules only; creation prices always come from the table.
const signature = variants => JSON.stringify(variants.map(v => [v.size, v.frame, v.inventoryPolicy, v.inventoryItem.tracked, v.inventoryItem.requiresShipping]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

// Resolve against current store records, never historical IDs or zero-price drafts.
export async function resolveStoreRules(shopify, catalog, savedProfiles = {}, requestedRatios = storeRatios) {
  assertStore(catalog.shop);
  if (catalog.templates.pageInfo.hasNextPage || catalog.references.pageInfo.hasNextPage) throw Error('店铺商品未读取完整，无法自动核对规则');
  const cache = new Map(), profiles = {}, rows = [];
  const read = async id => {
    if (!cache.has(id)) cache.set(id, await shopify.pricingProduct(id));
    return cache.get(id);
  };
  for (const ratio of requestedRatios) {
    const saved = savedProfiles[ratio];
    const drafts = catalog.templates.nodes.filter(p => /^\[RATIO DRAFT\]/i.test(p.title) && new RegExp('\\b' + ratio + '\\b').test(p.title));
    let template;
    const row = {ratio, status:'error'};
    // Read failures propagate: a partial scan must never be presented as agreement.
    if (saved?.templateId) template = await read(saved.templateId);
    else if (drafts.length === 1) template = await read(drafts[0].id);
    if (!template || productRatio(template) !== ratio || (!saved?.templateId && drafts.length !== 1)) {
      row.error = drafts.length > 1 ? '发现多个同一比例草稿，需要核对重复模板' : '缺少唯一且尺寸比例正确的草稿模板';
      rows.push(row); continue;
    }
    row.templateTitle = template.title;
    const candidates = saved?.referenceId ? [{id:saved.referenceId}] : catalog.references.nodes.filter(p => productRatio(p) === ratio).sort((a, b) => a.id.localeCompare(b.id));
    const valid = [], rejected = [];
    for (const candidate of candidates) {
      const reference = await read(candidate.id);
      try { valid.push(validatePricing(template, reference)); }
      catch (e) { rejected.push({title:reference?.title || candidate.id, reason:e.message}); }
    }
    if (!valid.length) row.error = '没有覆盖模板全部尺寸和装裱组合的可售非零定价参照';
    else if (new Set(valid.map(p => signature(p.variants))).size > 1) row.error = '在售参照的价格或库存规则存在冲突，需要核对店铺定价';
    else {
      const chosen = valid[0];
      profiles[ratio] = {templateId:template.id, referenceId:chosen.reference.id};
      Object.assign(row, {status:'ready', source:saved?.referenceId?'saved':'automatic', referenceTitle:chosen.reference.title, variantCount:chosen.variants.length, sizeCount:new Set(chosen.variants.map(v => v.size)).size, sourceCount:valid.length});
    }
    row.rejected = rejected;
    rows.push(row);
  }
  return {checkedAt:new Date().toISOString(), profiles, rows};
}
