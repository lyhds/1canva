import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_UNIT_COST, imageCost, sumCosts, formatCost } from "./product-studio/cost.js";
import { generate } from "./product-studio/providers.js";

const config = { endpoint: "https://example.com/v1/images/edits", model: "gpt-image-2-vip", apiKey: "test", protocol: "openai-edit" };
const bytes = Buffer.from("image");

test("a provider-reported cost is used as given", () => {
  assert.deepEqual(imageCost(0.12), { amount: 0.12, currency: "USD", source: "provider" });
  assert.deepEqual(imageCost(1.005), { amount: 1.005, currency: "USD", source: "provider" });
});

test("a silent or zero provider cost falls back to the owner unit price as an estimate", () => {
  // the configured provider answers cost 0, which must never be shown as a real amount
  for (const value of [0, null, undefined, NaN, -1, "0.4"]) {
    const cost = imageCost(value);
    assert.equal(cost.amount, IMAGE_UNIT_COST.amount, `amount for ${String(value)}`);
    assert.equal(cost.currency, "CNY");
    assert.equal(cost.source, "owner-estimate");
  }
  assert.equal(IMAGE_UNIT_COST.amount, 0.4);
  assert.equal(IMAGE_UNIT_COST.currency, "CNY");
});

test("generation attaches an estimate when the provider stays silent", async () => {
  const result = await generate(config, "Empty room", "4:5", [bytes], {
    fetcher: async () => Response.json({ data: [{ b64_json: bytes.toString("base64") }] }),
  });
  assert.equal(result.costUSD, null, "the raw provider value stays null for traceability");
  assert.equal(result.cost.source, "owner-estimate");
  assert.equal(result.cost.amount, 0.4);
  assert.equal(result.cost.unitAmount, 0.4);
});

test("generation keeps a real provider cost instead of the estimate", async () => {
  const result = await generate(config, "Empty room", "4:5", [bytes], {
    fetcher: async () => Response.json({ data: [{ b64_json: bytes.toString("base64") }], cost: 0.12 }),
  });
  assert.equal(result.costUSD, 0.12);
  assert.deepEqual(result.cost, { amount: 0.12, currency: "USD", source: "provider" });
});

test("job totals count generated images per currency and flag estimates", () => {
  const assets = {
    reference: [{ file: "reference.png" }],
    detail: [{ file: "detail.png" }],
    master: [{ file: "master.png", cost: { amount: 0.4, currency: "CNY", source: "owner-estimate" } }],
    "scene-1": [{ file: "scene-1.png", cost: { amount: 0.4, currency: "CNY", source: "owner-estimate" } }],
    "scene-2": [{ file: "scene-2.png", cost: { amount: 0.12, currency: "USD", source: "provider" } }],
  };
  const summary = sumCosts(assets);
  assert.deepEqual(summary.byCurrency, { CNY: 0.8, USD: 0.12 });
  assert.equal(summary.images, 3, "only generated images carry a cost");
  assert.equal(summary.estimatedImages, 2);
  assert.deepEqual(sumCosts({}), { byCurrency: {}, images: 0, estimatedImages: 0 });
  assert.equal(formatCost({ amount: 0.4, currency: "CNY" }), "¥0.40");
  assert.equal(formatCost({ amount: 2, currency: "USD" }), "$2.00");
});
