// Image cost bookkeeping for Product Studio.
//
// The configured image provider (api.vveai.com / gpt-image-2-vip) answers every
// generation with cost 0, which would read as "free". The owner supplied the real
// unit price on 2026-09-10: one successful generation costs about CNY 0.40.
//
// A provider-reported cost is trusted only when it is a positive finite number.
// Otherwise the owner's unit price is recorded and explicitly marked as an
// estimate, so an amount is never silently invented and never displayed as zero
// just because the provider stayed silent.
export const IMAGE_UNIT_COST = Object.freeze({
  amount: 0.4,
  currency: 'CNY',
  source: 'owner',
  recordedAt: '2026-09-10',
});

export function imageCost(providerCost, unit = IMAGE_UNIT_COST) {
  if (typeof providerCost === 'number' && Number.isFinite(providerCost) && providerCost > 0) {
    return { amount: Number(providerCost.toFixed(4)), currency: 'USD', source: 'provider' };
  }
  return {
    amount: unit.amount,
    currency: unit.currency,
    source: 'owner-estimate',
    unitAmount: unit.amount,
    unitCurrency: unit.currency,
  };
}

/** Totals for one job's assets: generated images only, grouped by currency. */
export function sumCosts(assets = {}) {
  let images = 0;
  let estimatedImages = 0;
  const byCurrency = {};
  for (const list of Object.values(assets)) {
    for (const asset of list || []) {
      const cost = asset?.cost;
      if (!cost || typeof cost.amount !== 'number') continue;
      images += 1;
      if (cost.source === 'owner-estimate') estimatedImages += 1;
      byCurrency[cost.currency] = (byCurrency[cost.currency] || 0) + cost.amount;
    }
  }
  for (const currency of Object.keys(byCurrency)) byCurrency[currency] = Number(byCurrency[currency].toFixed(4));
  return { byCurrency, images, estimatedImages };
}

export function formatCost(cost) {
  if (!cost) return '';
  const symbol = { CNY: '¥', USD: '$' }[cost.currency] || `${cost.currency} `;
  return `${symbol}${Number(cost.amount).toFixed(2)}`;
}
