import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { engine } from "./test-support/theme-fixtures.js";
import { browserDom } from "./test-support/browser-dom.js";

/**
 * The frame alias contract is stated once here and enforced against both
 * implementations: the Liquid snippet snippets/frame-key.liquid used by the
 * storefront snippets, and window.theme.frameKey in assets/utils.js used by
 * the browser components. Adding an alias to only one side fails this file.
 */
const ALIASES = {
  oak: ["Oak Float Frame", "Oak frame", "oak", "wood", "  OAK FLOAT FRAME  "],
  black: ["Black Float Frame", "Black frame", "black", "BLACK"],
  walnut: ["Walnut Float Frame", "Walnut frame", "walnut", " Walnut Frame "],
  white: ["White Float Frame", "white frame", "white", "WHITE"],
  gold: ["Gold Float Frame", "gold frame", "gold"],
  silver: ["Silver Float Frame", "silver frame", "silver"],
};

// Canvas-only delivery and unknown values must stay frame-less in both worlds.
const NOT_FRAMED = ["Rolled Canvas", "Stretched Canvas", "No frame", "", "   ", null, "Ivory", "Gold leaf"];

function browserFrameKey() {
  const dom = browserDom("<html><body></body></html>");
  dom.run("utils.js");
  return dom.window.theme.frameKey;
}

test("Liquid and browser alias tables agree for every accepted frame spelling", async () => {
  const liquid = engine();
  const frameKey = browserFrameKey();
  for (const [key, values] of Object.entries(ALIASES)) {
    for (const value of values) {
      assert.equal((await liquid.renderFile("frame-key", { frame: value })).trim(), key, `Liquid key for ${JSON.stringify(value)}`);
      assert.equal(frameKey(value), key, `browser key for ${JSON.stringify(value)}`);
    }
  }
  for (const value of NOT_FRAMED) {
    assert.equal((await liquid.renderFile("frame-key", { frame: value })).trim(), "", `Liquid frame-less for ${JSON.stringify(value)}`);
    assert.equal(frameKey(value), null, `browser frame-less for ${JSON.stringify(value)}`);
  }
});

test("every canonical key resolves to an existing swatch and option thumbnail", async () => {
  const liquid = engine();
  for (const key of Object.keys(ALIASES)) {
    const swatch = (await liquid.renderFile("frame-swatch", { frame: key })).trim();
    const option = (await liquid.renderFile("frame-option-image", { frame: key })).trim();
    assert.equal(swatch, `${key}-swatch.webp`);
    assert.equal(option, `${key}-frame-option.webp`);
    assert.ok(fs.existsSync(`assets/${swatch}`), `assets/${swatch}`);
    assert.ok(fs.existsSync(`assets/${option}`), `assets/${option}`);
  }
});

test("legacy aliases resolve to the same swatch and thumbnail as their canonical value", async () => {
  const liquid = engine();
  for (const [canonical, legacy] of [
    ["Oak Float Frame", "wood"],
    ["Black Float Frame", "Black frame"],
    ["White Float Frame", "white"],
    ["Walnut Float Frame", "Walnut frame"],
  ]) {
    for (const snippet of ["frame-swatch", "frame-option-image"]) {
      const expected = (await liquid.renderFile(snippet, { frame: canonical })).trim();
      assert.notEqual(expected, "");
      assert.equal((await liquid.renderFile(snippet, { frame: legacy })).trim(), expected, `${snippet} for ${legacy}`);
    }
  }
  // canvas delivery keeps its own photos and never gets a swatch
  assert.equal((await liquid.renderFile("frame-option-image", { frame: "Rolled Canvas" })).trim(), "rolled-canvas-photo.webp");
  assert.equal((await liquid.renderFile("frame-option-image", { frame: "Stretched Canvas" })).trim(), "stretched-canvas-photo.webp");
  assert.equal((await liquid.renderFile("frame-swatch", { frame: "Rolled Canvas" })).trim(), "");
});

test("browser frame materials keep the white and colour contract of the old table", () => {
  const dom = browserDom("<html><body></body></html>");
  dom.run("utils.js");
  const material = dom.window.theme.frameMaterial;
  // the vm realm returns plain objects with a foreign prototype, so compare fields
  const fields = (frame) => {
    const value = material(frame);
    return value ? { key: value.key, color: value.color } : null;
  };
  assert.deepEqual(fields("Oak Float Frame"), { key: "oak", color: "#bc8f5c" });
  assert.deepEqual(fields("wood"), { key: "oak", color: "#bc8f5c" });
  assert.deepEqual(fields("Black Float Frame"), { key: "black", color: "#171717" });
  assert.deepEqual(fields("White Float Frame"), { key: "white", color: "#f2f0ea" });
  assert.deepEqual(fields("white"), { key: "white", color: "#f2f0ea" });
  assert.deepEqual(fields("Silver Float Frame"), { key: "silver", color: "#aeb0ae" });
  assert.equal(fields("Rolled Canvas"), null);
  assert.equal(fields("No frame"), null);
  assert.equal(fields(undefined), null);
});
