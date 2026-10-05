/**
 * Backfill the products.custom.orientation metafield (2025-07).
 *
 * The orientation is derived from the artwork's master image (alt "master",
 * falling back to the featured image). These landscape/square/portrait
 * boundaries are the ones the Orientation storefront filter uses; they are
 * independent of the catalog ratio keys that snippets/product-aspect.liquid
 * snaps to for preview fallbacks:
 *   ratio < 0.9        -> Portrait
 *   0.9 <= ratio < 1.25 -> Square
 *   ratio >= 1.25      -> Landscape
 *
 * Usage:
 *   node scripts/set-orientation.js            # dry run: print the plan only
 *   node scripts/set-orientation.js --apply    # ensure definition + write values
 *   node scripts/set-orientation.js --force    # rewrite even unchanged values
 *   node scripts/set-orientation.js --help     # offline help
 *
 * The storefront "Orientation" filter must then be enabled once in
 * Shopify admin (Search & Discovery -> add filter -> Product metafield
 * custom.orientation). There is no admin API for that app.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const USAGE = `Usage:
  node scripts/set-orientation.js [options]

Options:
  --apply   Write metafield values (and create the metafield definition if
            missing). Without this flag the script only prints the plan.
  --force   Rewrite values even when the stored orientation already matches.
  -h, --help  Show this help without connecting to Shopify`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const unknownOption = args.find((v) => v.startsWith("--") && !["--apply", "--force"].includes(v));
if (unknownOption) {
  console.error(`Unknown option: ${unknownOption}\n\n${USAGE}`);
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  console.error(`Missing configuration file: ${envPath}`);
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

const NAMESPACE = "custom";
const KEY = "orientation";
const CHOICES = ["Landscape", "Portrait", "Square"];

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

function orientationOf(width, height) {
  if (!width || !height) return null;
  const ar = width / height;
  if (ar < 0.9) return "Portrait";
  if (ar < 1.25) return "Square";
  return "Landscape";
}

function masterImage(product) {
  const media = (product.media?.nodes || [])
    .filter((m) => m.image)
    .map((m) => ({ alt: m.alt, ...m.image }));
  const master = media.find((img) => (img.alt || "").trim().toLowerCase() === "master");
  const featured = product.featuredMedia?.image
    ? { alt: product.featuredMedia.alt, ...product.featuredMedia.image }
    : null;
  return master || featured || media[0] || null;
}

(async () => {
  const tok = await token();

  if (APPLY) {
    const defs = await gql(
      tok,
      `query { metafieldDefinitions(first: 50, namespace: "${NAMESPACE}", ownerType: PRODUCT) { nodes { key name } } }`
    );
    const exists = defs.data.metafieldDefinitions.nodes.some((d) => d.key === KEY);
    if (!exists) {
      const created = await gql(
        tok,
        `mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id key }
            userErrors { field message code }
          }
        }`,
        {
          definition: {
            name: "Orientation",
            namespace: NAMESPACE,
            key: KEY,
            description: "Artwork orientation derived from the master image (used by the storefront Orientation filter).",
            ownerType: "PRODUCT",
            type: "single_line_text_field",
            validations: [{ name: "choices", value: JSON.stringify(CHOICES) }],
          },
        }
      );
      const errs = created.data.metafieldDefinitionCreate.userErrors;
      if (errs.length) {
        console.log("Could not create the metafield definition:", JSON.stringify(errs));
        console.log(`Create it manually: Settings -> Metafields -> Products -> Add definition\n  namespace "${NAMESPACE}", key "${KEY}", type single line text, then rerun.`);
        process.exit(1);
      }
      console.log("created metafield definition custom.orientation");
    }
  }

  const plan = [];
  let cursor = null;
  do {
    const page = await gql(
      tok,
      `query products($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            status
            featuredMedia { ... on MediaImage { alt image { width height } } }
            media(first: 20) { nodes { ... on MediaImage { alt image { width height } } } }
            orientation: metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value }
          }
        }
      }`,
      { cursor }
    );
    for (const node of page.data.products.nodes) {
      const img = masterImage(node);
      const next = orientationOf(img?.width, img?.height);
      plan.push({
        id: node.id,
        title: node.title,
        status: node.status,
        dims: img ? `${img.width}x${img.height}` : "no image",
        current: node.orientation?.value || null,
        next,
      });
    }
    cursor = page.data.products.pageInfo.hasNextPage ? page.data.products.pageInfo.endCursor : null;
  } while (cursor);

  const updates = plan.filter(
    (row) => row.next && (FORCE || row.current !== row.next)
  );
  for (const row of plan) {
    const tag = updates.includes(row) ? "SET" : "skip";
    console.log(
      `[${tag}] ${row.title} (${row.status}) ${row.dims} -> ${row.next || "unknown"}${row.current ? ` (was ${row.current})` : ""}`
    );
  }
  console.log(`\n${updates.length} of ${plan.length} products to update.`);

  if (!updates.length) {
    console.log("Nothing to write.");
    process.exit(0);
  }
  if (!APPLY) {
    console.log("Dry run only — rerun with --apply to write these values.");
    process.exit(0);
  }

  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50).map((row) => ({
      ownerId: row.id,
      namespace: NAMESPACE,
      key: KEY,
      type: "single_line_text_field",
      value: row.next,
    }));
    const res = await gql(
      tok,
      `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { metafields: batch }
    );
    const errs = res.data.metafieldsSet.userErrors;
    if (errs.length) {
      console.log("WRITE ERRORS:", JSON.stringify(errs));
      process.exit(1);
    }
    console.log(`wrote ${Math.min(i + 50, updates.length)}/${updates.length}`);
  }
  console.log("Done. Enable the filter once in Search & Discovery (Product metafield custom.orientation).");
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
