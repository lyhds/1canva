import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./build-mesonart-catalog.js", import.meta.url));
const FRAME_PRICES = {
  "Stretch+Wood Frame": "600.00",
  "Stretch+Black Frame": "610.00",
  "Stretch+White Frame": "620.00",
  "Stretch + Gold Frame": "630.00",
  "Stretch+Silver Frame": "640.00",
  "Rolled Canvas": "292.00",
  Frameless: "526.00",
};

/** 100 distinct products (the script's minimum sample) for one 3:4 size. */
function fixture() {
  const rows = [];
  for (let product = 0; product < 100; product++) {
    for (const [frame, price] of Object.entries(FRAME_PRICES)) {
      rows.push({
        ratio: "3:4", inches: [24, 32], cm: [61, 81], frame, price,
        productId: `p${product}`, handle: `handle-${product}`, variantId: `v${product}-${frame}`,
      });
    }
  }
  return rows;
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvasra-price-table-"));
  fs.mkdirSync(path.join(root, "data", "pricing"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "pricing", "mesonart-catalog.json"), "SENTINEL-CATALOG\n");
  fs.writeFileSync(path.join(root, "docs", "PRICE_TABLE.md"), "SENTINEL-REPORT\n");
  fs.writeFileSync(path.join(root, "variants.json"), JSON.stringify(fixture()));
  return root;
}

const run = (root, args) => execFileSync(process.execPath, [SCRIPT, "variants.json", ...args], { cwd: root, stdio: "pipe" }).toString();
const read = (root, relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("the default run reports the plan without touching the price table or the report", () => {
  const root = sandbox();
  try {
    const result = JSON.parse(run(root, []));
    assert.equal(result.mode, "dry-run");
    assert.equal(result.summary["3:4"], 1);
    assert.deepEqual(result.changes.map((change) => change.file), ["data/pricing/mesonart-catalog.json", "docs/PRICE_TABLE.md"]);
    assert.ok(result.changes.every((change) => change.changed));
    assert.equal(read(root, "data/pricing/mesonart-catalog.json"), "SENTINEL-CATALOG\n");
    assert.equal(read(root, "docs/PRICE_TABLE.md"), "SENTINEL-REPORT\n");
    assert.equal(fs.existsSync(path.join(root, ".shopify")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--apply backs up both files first, then writes the table and the report", () => {
  const root = sandbox();
  try {
    const result = JSON.parse(run(root, ["--apply"]));
    assert.equal(result.mode, "apply");
    assert.deepEqual(result.written, ["data/pricing/mesonart-catalog.json", "docs/PRICE_TABLE.md"]);
    // the backup keeps the previous content of both files
    const backup = path.join(root, result.backup);
    assert.ok(fs.existsSync(backup), result.backup);
    assert.equal(fs.readFileSync(path.join(backup, "mesonart-catalog.json"), "utf8"), "SENTINEL-CATALOG\n");
    assert.equal(fs.readFileSync(path.join(backup, "PRICE_TABLE.md"), "utf8"), "SENTINEL-REPORT\n");
    // exact modal prices survive into both outputs
    const catalog = JSON.parse(read(root, "data/pricing/mesonart-catalog.json"));
    const size = catalog.profiles["3:4"][0];
    assert.deepEqual(size.cm, [61, 81]);
    assert.equal(size.prices["Oak Float Frame"], "600.00");
    assert.equal(size.prices["Rolled Canvas"], "292.00");
    assert.equal(size.evidence["Oak Float Frame"].modeCount, 100);
    const report = read(root, "docs/PRICE_TABLE.md");
    assert.match(report, /\| 61 × 81 \| 24 × 32 \| 292\.00 \| 526\.00 \| 600\.00 \| 610\.00 \| 620\.00 \| 630\.00 \| 640\.00 \|/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-running the same input is idempotent and reports no change", () => {
  const root = sandbox();
  try {
    run(root, ["--apply"]);
    const second = JSON.parse(run(root, []));
    assert.ok(second.changes.every((change) => !change.changed), "second run should be a no-op");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
