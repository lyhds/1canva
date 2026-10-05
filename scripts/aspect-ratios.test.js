import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { engine } from "./test-support/theme-fixtures.js";
import { browserDom } from "./test-support/browser-dom.js";

/**
 * The six catalog ratios are 3:4, 2:3, 1:1, 4:3, 3:2 and 2:1. The theme's
 * fallback table (used when a master image exposes no dimensions) must carry
 * every one of them; the retired portrait/landscape/34/21 ladder may stay as a
 * legacy alias but must not be the only vocabulary left.
 */
const RATIOS = { 34: 0.75, 23: 0.6667, square: 1, 43: 1.3333, 32: 1.5, 21: 2 };

const fallbackOf = (html) => Number(parseHTML(html).document.querySelector(".frame-box").getAttribute("style").match(/--ar:\s*([\d.]+)/)[1]);

test("product-aspect snaps a real master to its own catalog ratio key", async () => {
  const liquid = engine();
  for (const [key, value] of Object.entries(RATIOS)) {
    const master = { alt: "master", width: Math.round(value * 1200), height: 1200 };
    const aspect = (await liquid.renderFile("product-aspect", { product: { media: [master] } })).trim();
    assert.equal(aspect, key, `${master.width}x${master.height}`);
  }
  // no usable dimensions keeps the theme-wide 0.8 default
  const undefinedMaster = (await liquid.renderFile("product-aspect", { product: { media: [{ alt: "master" }] } })).trim();
  assert.equal(undefinedMaster, "portrait");
});

test("each emitted key round-trips to the true fallback ratio in a frame preview", async () => {
  const liquid = engine();
  for (const [key, value] of Object.entries(RATIOS)) {
    const aspect = (await liquid.renderFile("product-aspect", { product: { media: [{ alt: "master", width: Math.round(value * 1200), height: 1200 }] } })).trim();
    // the preview only reaches the fallback when the master has no dimensions
    const html = await liquid.renderFile("frame-preview", { master: { src: "/master.png" }, frame: "Oak Float Frame", aspect });
    assert.equal(fallbackOf(html), value, `fallback for ${key}`);
  }
});

test("a legacy ratio key is still accepted rather than collapsing to square", async () => {
  const liquid = engine();
  const portrait = await liquid.renderFile("frame-preview", { master: { src: "/master.png" }, frame: "Oak Float Frame", aspect: "portrait" });
  assert.equal(fallbackOf(portrait), 0.8);
  const landscape = await liquid.renderFile("frame-preview", { master: { src: "/master.png" }, frame: "Oak Float Frame", aspect: "landscape" });
  assert.equal(fallbackOf(landscape), 1.5);
  // a real master always wins over the fallback
  const measured = await liquid.renderFile("frame-preview", { master: { src: "/master.png", width: 1000, height: 1500 }, frame: "Oak Float Frame", aspect: "square" });
  assert.equal(fallbackOf(measured), 1000 / 1500);
});

test("browser markup uses the same six-ratio fallback table", () => {
  const dom = browserDom("<html><body></body></html>");
  dom.run("utils.js");
  for (const [key, value] of Object.entries(RATIOS)) {
    const markup = dom.window.theme.frameArtMarkup("/master.png", "Oak Float Frame", "", key, null);
    assert.ok(markup.includes(`--ar:${value}`), `browser fallback for ${key}: ${markup.slice(0, 120)}`);
  }
  // an exact ratio from the API always wins, and legacy keys still resolve
  assert.ok(dom.window.theme.frameArtMarkup("/master.png", "Oak Float Frame", "", "square", 1.4).includes("--ar:1.4"));
  assert.ok(dom.window.theme.frameArtMarkup("/master.png", "Oak Float Frame", "", "portrait", null).includes("--ar:0.8"));
});
