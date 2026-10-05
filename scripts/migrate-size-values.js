/**
 * Migrate Size option values from letters (S/M/L/XL/XXL) to real dimensions
 * ("50 × 70 cm"), derived per product from the master image's aspect ratio.
 * This retired five-size schema keeps its own legacy ladder:
 *   34|0.75, portrait|0.8, square|1.0, landscape|1.5, 21|2.0
 * The current storefront no longer uses that ladder: snippets/product-aspect
 * .liquid snaps to the six catalog ratios (34|0.75, 23|0.6667, square|1.0,
 * 43|1.3333, 32|1.5, 21|2.0). Do not reuse this script's buckets as the
 * current standard.
 *
 * Prices are carried over per tier position (S->first value ... XXL->fifth)
 * for every frame value found on the product; the frame option itself is
 * untouched. A full product backup is dumped to .shopify/ before any write.
 *
 * Usage:
 *   node scripts/migrate-size-values.js                     # dry run plan
 *   node scripts/migrate-size-values.js --only <substring>  # limit products
 *   node scripts/migrate-size-values.js --apply             # write
 *   node scripts/migrate-size-values.js --help              # offline help
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const USAGE = `LEGACY: letter-tier migration only; not for current product size ladders.
Writes require both --apply and --allow-legacy.

Usage:
  node scripts/migrate-size-values.js [options]

Options:
  --apply            Rewrite the Size option values on Shopify (default: dry run).
  --allow-legacy     Explicitly permit a legacy size migration.
  --only <substring> Only products whose handle contains this substring.
  -h, --help         Show this help without connecting to Shopify`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const APPLY = args.includes("--apply");
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const unknown = args.find((v, i) => v.startsWith("--") && v !== "--apply" && v !== "--allow-legacy" && v !== "--only" && i !== onlyIdx + 1);
if (unknown) {
  console.error(`Unknown option: ${unknown}\n\n${USAGE}`);
  process.exit(1);
}

if (APPLY && !args.includes('--allow-legacy')) {
  console.error('Legacy migration blocked. Use --allow-legacy only after reviewing the target products and backups.');
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
for (const key of ["SHOPIFY_STORE", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]) {
  if (!env[key]) {
    console.error(`Missing ${key} in .env`);
    process.exit(1);
  }
}
const STORE = env.SHOPIFY_STORE.replace(/^https?:\/\//, "").replace(/\/$/, "");
const API_VERSION = env.SHOPIFY_API_VERSION || "2025-07";
const API = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

const LETTERS = ["S", "M", "L", "XL", "XXL"];
const DIMS = {
  "34": ["30 × 40 cm", "45 × 60 cm", "60 × 80 cm", "75 × 100 cm", "90 × 120 cm"],
  portrait: ["30 × 40 cm", "40 × 50 cm", "50 × 70 cm", "70 × 100 cm", "100 × 150 cm"],
  square: ["30 × 30 cm", "40 × 40 cm", "50 × 50 cm", "70 × 70 cm", "100 × 100 cm"],
  landscape: ["40 × 30 cm", "50 × 40 cm", "70 × 50 cm", "100 × 70 cm", "150 × 100 cm"],
  "21": ["40 × 20 cm", "60 × 30 cm", "80 × 40 cm", "100 × 50 cm", "150 × 75 cm"],
};
const ASPECT_CANDIDATES = [["34", 0.75], ["portrait", 0.8], ["square", 1.0], ["landscape", 1.5], ["21", 2.0]];

async function token() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token: " + JSON.stringify(j));
  return j.access_token;
}

async function gql(tok, query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (!j.data) {
    console.log("GQL ERRORS:", JSON.stringify(j).slice(0, 500));
    process.exit(1);
  }
  return j;
}

function aspectOf(width, height) {
  if (!width || !height) return null;
  const ar = width / height;
  let best = null;
  let bestDiff = 99;
  for (const [name, cand] of ASPECT_CANDIDATES) {
    const diff = Math.abs(ar - cand);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return best;
}

function masterImage(product) {
  const media = (product.media?.nodes || []).filter((m) => m.image).map((m) => ({ alt: m.alt, ...m.image }));
  const master = media.find((img) => (img.alt || "").trim().toLowerCase() === "master");
  const featured = product.featuredMedia?.image ? { alt: product.featuredMedia.alt, ...product.featuredMedia.image } : null;
  return master || featured || media[0] || null;
}

/** Build the migration plan for one product, or null when not applicable. */
function planProduct(product) {
  const sizeOpt = product.options.find((o) => o.name.toLowerCase() === "size");
  if (!sizeOpt) return { product, skip: "no Size option" };
  if (!sizeOpt.values.every((v) => LETTERS.includes(v))) {
    return { product, skip: `Size values not letters: ${sizeOpt.values.join(",")}` };
  }
  const frameOpt = product.options.find((o) => o.name.toLowerCase() === "frame");
  if (!frameOpt) return { product, skip: "no Frame option" };
  const img = masterImage(product);
  const aspect = aspectOf(img?.width, img?.height);
  if (!aspect) return { product, skip: "no master image dimensions" };
  const newValues = DIMS[aspect];
  // frame values in their current order; never hardcode
  const frameValues = [...frameOpt.values];
  // price per (tier index, frame) from the existing variants
  const priceMap = {};
  for (const v of product.variants.nodes) {
    const letter = v.selectedOptions.find((o) => o.name.toLowerCase() === sizeOpt.name.toLowerCase())?.value;
    const frame = v.selectedOptions.find((o) => o.name.toLowerCase() === frameOpt.name.toLowerCase())?.value;
    const tier = LETTERS.indexOf(letter);
    if (tier < 0) continue;
    priceMap[`${tier}|${frame}`] = { price: v.price, compareAtPrice: v.compareAtPrice };
  }
  // rebuild variants in the store's option order (Size outer or inner as found)
  const sizeFirst = product.options.indexOf(sizeOpt) < product.options.indexOf(frameOpt);
  const variants = [];
  const sizes = sizeFirst ? newValues : frameValues;
  const others = sizeFirst ? frameValues : newValues;
  for (const a of sizes) {
    for (const b of others) {
      const sizeVal = sizeFirst ? a : b;
      const frameVal = sizeFirst ? b : a;
      const tier = newValues.indexOf(sizeVal);
      const p = priceMap[`${tier}|${frameVal}`];
      if (!p) return { product, skip: `missing price for tier ${tier} + ${frameVal}` };
      const variant = {
        optionValues: [
          { optionName: sizeOpt.name, name: sizeVal },
          { optionName: frameOpt.name, name: frameVal },
        ],
        price: p.price,
        inventoryPolicy: "CONTINUE",
      };
      if (p.compareAtPrice) variant.compareAtPrice = p.compareAtPrice;
      variants.push(variant);
    }
  }
  return {
    product,
    aspect,
    oldValues: LETTERS,
    newValues,
    frameValues,
    variants,
    input: {
      id: product.id,
      productOptions: [
        { name: sizeOpt.name, values: newValues.map((name) => ({ name })) },
        { name: frameOpt.name, values: frameValues.map((name) => ({ name })) },
      ],
      variants,
    },
  };
}

(async () => {
  const tok = await token();

  // fetch all products with options/variants/media
  const products = [];
  let cursor = null;
  do {
    const page = await gql(
      tok,
      `query products($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            status
            options { id name values }
            variants(first: 50) { nodes { id selectedOptions { name value } price compareAtPrice inventoryPolicy } }
            featuredMedia { ... on MediaImage { alt image { width height } } }
            media(first: 20) { nodes { ... on MediaImage { alt image { width height } } } }
          }
        }
      }`,
      { cursor }
    );
    products.push(...page.data.products.nodes);
    cursor = page.data.products.pageInfo.hasNextPage ? page.data.products.pageInfo.endCursor : null;
  } while (cursor);

  const scoped = ONLY ? products.filter((p) => p.handle.includes(ONLY)) : products;
  const plans = scoped.map(planProduct);
  const actionable = plans.filter((p) => !p.skip);
  const skipped = plans.filter((p) => p.skip);

  for (const plan of actionable) {
    console.log(
      `plan: ${plan.product.handle} | aspect ${plan.aspect} | ${plan.oldValues.join(",")} -> ${plan.newValues.join(", ")} | frames: ${plan.frameValues.join(", ")} | ${plan.variants.length} variants`
    );
  }
  for (const s of skipped) console.log(`skip: ${s.product.handle} | ${s.skip}`);
  console.log(`\n${actionable.length} to migrate, ${skipped.length} skipped. Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  if (!APPLY) process.exit(0);
  if (!actionable.length) process.exit(0);

  // backup every product we are about to touch
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(ROOT, ".shopify", `size-migration-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const plan of actionable) {
    fs.writeFileSync(path.join(backupDir, `${plan.product.handle}.json`), JSON.stringify(plan.product, null, 2), "utf8");
  }
  console.log(`backed up ${actionable.length} products -> ${backupDir}`);

  let failed = false;
  for (const plan of actionable) {
    const res = await gql(
      tok,
      `mutation productSet($input: ProductSetInput!) {
        productSet(input: $input) {
          product { id handle options { name values } variants(first: 50) { nodes { id selectedOptions { name value } price } } }
          userErrors { field message }
        }
      }`,
      { input: plan.input }
    );
    const ps = res.data.productSet;
    if (ps.userErrors.length) {
      console.error(`FAIL ${plan.product.handle}:`, JSON.stringify(ps.userErrors));
      failed = true;
      continue;
    }
    const got = ps.product;
    const sizes = got.options.find((o) => o.name.toLowerCase() === "size")?.values || [];
    const frames = got.options.find((o) => o.name.toLowerCase() === "frame")?.values || [];
    const priceOK = plan.variants.every((want) => {
      const gotVariant = got.variants.nodes.find((v) => v.selectedOptions.map((o) => o.value).join(" / ") === want.optionValues.map((o) => o.name).join(" / "));
      return gotVariant && Number(gotVariant.price) === Number(want.price);
    });
    console.log(
      `migrated: ${got.handle} | variants: ${got.variants.nodes.length}/${plan.variants.length} | prices ${priceOK ? "MATCH" : "MISMATCH"} | sizes: ${sizes.join(" / ")} | frames: ${frames.join(", ")}`
    );
    if (!priceOK || got.variants.nodes.length !== plan.variants.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
