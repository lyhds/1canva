import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function parseShopifyJson(relativePath) {
  const source = read(relativePath).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  return JSON.parse(source);
}

function collectValues(value, key, found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "string" && entryValue) found.push(entryValue);
    collectValues(entryValue, key, found);
  }
  return found;
}

test("decorative frame previews are hidden from assistive technology", () => {
  const preview = read("snippets/frame-preview.liquid");
  assert.match(preview, /if alt != blank.*role="img" aria-label=.*else.*aria-hidden="true"/s);
});

test("Liquid JavaScript asset references resolve", () => {
  const liquidFiles = ["layout", "sections", "snippets"]
    .flatMap((directory) => walk(path.join(ROOT, directory)))
    .filter((file) => file.endsWith(".liquid"));
  const references = liquidFiles.flatMap((file) =>
    [...fs.readFileSync(file, "utf8").matchAll(/'([^']+\.js)'\s*\|\s*asset_url/g)].map(
      (match) => match[1]
    )
  );
  assert.ok(references.length > 0);
  for (const asset of references) {
    assert.ok(fs.existsSync(path.join(ROOT, "assets", asset)), `Missing assets/${asset}`);
  }
});

test("homepage cover assets resolve and use WebP for large card imagery", () => {
  const index = parseShopifyJson("templates/index.json");
  const covers = collectValues(index, "cover_asset");
  assert.ok(covers.length > 0);
  for (const asset of covers) {
    assert.ok(fs.existsSync(path.join(ROOT, "assets", asset)), `Missing assets/${asset}`);
    if (/^(subject|room)-/.test(asset)) assert.equal(path.extname(asset), ".webp");
  }

  for (const section of ["sections/collections-row.liquid", "sections/compositions.liquid"]) {
    const source = read(section);
    assert.match(source, /cover_asset \| asset_url/);
    assert.doesNotMatch(source, /cover_asset \| asset_img_url/);
  }
});

test("subject filtering uses canonical collection membership rather than product tags", () => {
  const filters = read("snippets/collection-filter-groups.liquid");
  assert.match(filters, /collections\[subject_handle\]/);
  assert.match(filters, /value="{{ subject_collection.url }}"/);
  assert.doesNotMatch(filters, /col-abstract|current_tags/);
  assert.match(read("sections/main-collection.liquid"), /render 'collection-subject-handles'/);
  assert.doesNotMatch(read("assets/collection-filters.js"), /encodeURIComponent\(subjectTag\)/);
});

test("orientation filter renders shape controls bound to storefront filter params", () => {
  const filters = read("snippets/collection-filter-groups.liquid");
  assert.match(filters, /filter\.param_name contains 'orientation'/);
  assert.match(filters, /data-orientation-filter/);
  // the shapes toggle real storefront-filter inputs, so the AJAX form keeps working
  assert.match(filters, /name="{{ value\.param_name }}"/);
  for (const shape of ["landscape", "portrait"]) {
    assert.match(filters, new RegExp(`when '${shape}'`));
  }
  const backfill = read("scripts/set-orientation.js");
  for (const boundary of ["0.9", "1.25"]) {
    assert.match(backfill, new RegExp(boundary.replace(".", "\\.")));
  }
});

test("size option values are real dimensions, not letter tiers", () => {
  // the size-dims letter->dimensions lookup snippet is retired
  const themeFiles = ["sections", "snippets"].flatMap((dir) => walk(path.join(ROOT, dir))).filter((f) => f.endsWith(".liquid"));
  for (const file of themeFiles) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8").replace(/data-row-size-dims/g, ""), /size-dims/, `${file} still references size-dims`);
  }
  // the PDP shows option values as-is; the picker propagates the selected value
  const mainProduct = read("sections/main-product.liquid");
  assert.doesNotMatch(mainProduct, /data-size-line/);
  assert.doesNotMatch(mainProduct, /data-dims="/);
  // desktop sizes collapse into a dropdown that is closed by default
  assert.match(mainProduct, /<details data-size-dropdown class="group\/sizedd relative">/);
  assert.doesNotMatch(mainProduct, /data-size-dropdown[^>]*\sopen/);
  // product creation derives dimension values from the master image
  const create = read("scripts/create-product.js");
  assert.match(create, /SIZE_VALUES = DIMS\[aspect\]/);
  assert.match(create, /"50 × 70 cm"/);
  const migrate = read("scripts/migrate-size-values.js");
  assert.match(migrate, /priceMap/);
  assert.match(migrate, /"100 × 150 cm"/);
  // the real scale visualizer is wired into the PDP with true-proportion rendering
  assert.match(mainProduct, /render 'size-guide', product: product/);
  const guide = read("snippets/size-guide.liquid");
  assert.match(guide, /data-size-guide-data/);
  assert.match(guide, /data-sg-apply/);
  assert.match(guide, /metafields\.custom\.size_guide_enabled\.value/);
  assert.doesNotMatch(guide, /assign sg_flag = product\.metafields\.custom\.size_guide_enabled\s*$/m);
  const engine = read("assets/size-guide-visualizer.js");
  assert.match(engine, /980 \/ \(right - left\)/);
  for (const svg of ["sg-sofa.svg", "sg-bed.svg", "sg-console.svg"]) {
    assert.ok(fs.existsSync(path.join(ROOT, "assets", svg)), `Missing assets/${svg}`);
  }
});

test("browser zoom is not globally cancelled", () => {
  const utils = read("assets/utils.js");
  const css = read("src/theme.css");
  assert.doesNotMatch(utils, /gesturestart|gesturechange|gestureend/);
  assert.doesNotMatch(utils, /touches\.length\s*>\s*1/);
  assert.doesNotMatch(css, /touch-action:\s*manipulation/);
});

test("shared HTML escaping handles text and attribute delimiters", () => {
  const context = vm.createContext({ window: {}, URL });
  vm.runInContext(read("assets/utils.js"), context);
  assert.equal(
    context.window.theme.escapeHtml(`<img src="x" onerror='bad'>&`),
    "&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;&amp;"
  );
  const predictiveSearch = read("assets/predictive-search.js");
  assert.match(predictiveSearch, /escape\(p\.title/);
  assert.match(predictiveSearch, /if \(!response\.ok\)/);
});

test("wishlist handles migrate and deduplicate legacy product ids", () => {
  const storageKey = "makeready-wishlist";
  const storage = new Map([
    [storageKey, JSON.stringify(["123", "legacy-handle", "legacy-handle"])],
  ]);
  const context = vm.createContext({
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { querySelectorAll: () => [], addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    CustomEvent: class CustomEvent {},
  });
  vm.runInContext(read("assets/wishlist.js"), context);

  assert.deepEqual(JSON.parse(JSON.stringify(context.window.wishlist.items())), ["123", "legacy-handle"]);
  context.window.wishlist.toggle("new-handle", "123");
  assert.deepEqual(JSON.parse(storage.get(storageKey)), ["legacy-handle"]);
  context.window.wishlist.toggle("new-handle", "123");
  assert.deepEqual(JSON.parse(storage.get(storageKey)), ["legacy-handle", "new-handle"]);
  context.window.wishlist.replace(["new-handle", "new-handle"]);
  assert.deepEqual(JSON.parse(storage.get(storageKey)), ["new-handle"]);

  assert.match(read("snippets/product-card.liquid"), /data-wishlist-toggle="\{\{ product\.handle \}\}"/);
  assert.match(read("sections/main-wishlist.liquid"), /product_id_key \| json/);
});

test("frame preview docs and source use the current DOM contract", () => {
  const sources = read("src/theme.css") + read("PRODUCT_PUBLISH_API.md");
  assert.doesNotMatch(sources, /data-frame-(master|overlay)/);
  assert.match(sources, /frame-box/);
});

test("variant option values are escaped before entering data attributes", () => {
  const product = read("sections/main-product.liquid");
  assert.doesNotMatch(product, /data-option-value="\{\{ value \}\}"/);
  assert.equal(
    [...product.matchAll(/data-option-value="\{\{ value \| escape \}\}"/g)].length,
    4
  );
  assert.equal(
    [...product.matchAll(/data-size-price="\{\{ value \| escape \}\}"/g)].length,
    2
  );
});

test("product cards localize a starting price only when variant prices differ", () => {
  const card = read("snippets/product-card.liquid");
  assert.match(card, /if product\.price_varies/);
  assert.match(card, /'products\.product\.from_price_html' \| t: price: ''/);
  assert.match(card, /data-display-money data-cents="\{\{ product\.price \}\}"/);
  assert.doesNotMatch(card, /product\.price \| plus/);
});

test("delivery copy and timeline agree with the published shipping policy", () => {
  const shippingSources = [
    "config/settings_data.json",
    "sections/announcement-bar.liquid",
    "sections/main-product.liquid",
    "templates/product.json",
    "locales/en.default.json",
  ].map(read).join("\n");
  assert.doesNotMatch(shippingSources, /worldwide|Netherlands|Delivery fees/i);
  assert.match(shippingSources, /China/);
  assert.doesNotMatch(shippingSources, /U\.S\.|United States|Canada|Australia/);

  const schema = JSON.parse(read("config/settings_schema.json"));
  const cartGroup = schema.find((group) => group.name === "购物车");
  const threshold = cartGroup.settings.find((setting) => setting.id === "free_shipping_threshold");
  assert.equal(threshold.default, 0);

  const product = read("sections/main-product.liquid");
  assert.match(product, /delivery_step_order/);
  assert.match(product, /delivery_step_complete/);
  assert.doesNotMatch(product, /delivery_step_shipped/);
  assert.doesNotMatch(product, /delivery_tracking/);
  assert.doesNotMatch(product, /append: ship_max_ts \| date|append: arr_max_ts \| date/);
});

test("unverified review content is disabled by default and cannot be seeded", () => {
  const schema = JSON.parse(read("config/settings_schema.json"));
  const reviewGroup = schema.find((group) => group.name === "评价");
  const reviewSetting = reviewGroup.settings.find((setting) => setting.id === "enable_customer_reviews");
  assert.equal(reviewSetting.default, false);

  const index = parseShopifyJson("templates/index.json");
  assert.ok(!Object.values(index.sections).some((section) => section.type === "reviews"));
  assert.ok(!index.order.includes("reviews"));

  for (const source of [
    read("sections/main-product.liquid"),
    read("sections/product-reviews.liquid"),
    read("sections/reviews.liquid"),
    read("snippets/json-ld-product.liquid"),
  ]) {
    assert.match(source, /enable_customer_reviews/);
  }

  const setupReviews = read("scripts/setup-reviews.js");
  assert.doesNotMatch(setupReviews, /--seed|DEMO_REVIEWS|Marie K\./);
});

test("committed CSS matches a fresh Tailwind build", () => {
  const cliPackageDirectory = path.join(ROOT, "node_modules", "@tailwindcss", "cli");
  const cliPackage = JSON.parse(fs.readFileSync(path.join(cliPackageDirectory, "package.json"), "utf8"));
  const cliRelativePath = typeof cliPackage.bin === "string" ? cliPackage.bin : cliPackage.bin.tailwindcss;
  const cliPath = path.resolve(cliPackageDirectory, cliRelativePath);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canvasra-css-"));
  const outputPath = path.join(temporaryRoot, "theme.css");
  try {
    execFileSync(process.execPath, [cliPath, "-i", "src/theme.css", "-o", outputPath, "--minify"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    assert.equal(fs.readFileSync(outputPath, "utf8"), read("assets/theme.css"));
  } finally {
    const resolvedTemp = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir()) + path.sep;
    if (!resolvedTemp.startsWith(resolvedSystemTemp)) throw new Error("Unsafe temporary path");
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
});
