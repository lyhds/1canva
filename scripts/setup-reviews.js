/**
 * Set up the no-app review system via the Admin API (2026-01).
 *
 * Creates (idempotent, safe to re-run):
 *  1. metaobject definition "review"  — rating, author, title, body, date, verified, photo
 *  2. product metafield definition custom.reviews (list of review references)
 *
 * After this: Admin → Content → Metaobjects → Review (add entries),
 * then on each product set the metafield custom.reviews to the review entries.
 * The theme renders the PDP rating + review section only when this list is non-empty.
 *
 * Usage:
 *   node scripts/setup-reviews.js
 *   node scripts/setup-reviews.js --list                       # list products (handle | title)
 *   node scripts/setup-reviews.js --verify                     # print attached reviews
 *   node scripts/setup-reviews.js --clean --yes                # delete all review metaobjects
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const USAGE = `Usage:
  node scripts/setup-reviews.js [options]

Without an action, the script idempotently creates the review definitions.

Options:
  --list                    List products
  --verify                  Print reviews attached to products
  --clean --yes             Delete all review metaobjects (destructive)
  -h, --help                Show this help without connecting to Shopify`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const knownOptions = new Set(["--list", "--verify", "--clean", "--yes"]);
const unknownOption = args.find((value) => value.startsWith("-") && !knownOptions.has(value));
if (unknownOption) {
  console.error(`Unknown option: ${unknownOption}\n\n${USAGE}`);
  process.exit(1);
}

const LIST = args.includes("--list");
const CLEAN = args.includes("--clean");
const VERIFY = args.includes("--verify");

const actions = [LIST, CLEAN, VERIFY].filter(Boolean).length;
if (actions > 1) {
  console.error(`Choose only one of --list, --clean, or --verify.\n\n${USAGE}`);
  process.exit(1);
}
if (CLEAN && !args.includes("--yes")) {
  console.error("--clean deletes every review metaobject. Re-run with --clean --yes to confirm.");
  process.exit(1);
}
if (!CLEAN && args.includes("--yes")) {
  console.error("--yes is only valid together with --clean.");
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
const API_VERSION = env.SHOPIFY_API_VERSION || "2026-01";
const API = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

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
  if (!j.data || j.errors) {
    console.log("GQL ERRORS:", JSON.stringify(j.errors || j).slice(0, 800));
    if (!j.data) process.exit(1);
  }
  return j;
}

const errStr = (ue) => (ue || []).map((e) => e.message).join("; ");

async function ensureMetaobjectDefinition(tok) {
  const found = await gql(tok, `{ metaobjectDefinitionByType(type: "review") { id type } }`);
  if (found.data.metaobjectDefinitionByType) {
    console.log("metaobject definition 'review' already exists");
    return;
  }
  const res = await gql(
    tok,
    `mutation {
      metaobjectDefinitionCreate(definition: {
        name: "Review",
        type: "review",
        access: { storefront: PUBLIC_READ }
        fieldDefinitions: [
          { key: "rating",   name: "Rating (1-5)",    required: true,  type: "number_integer" }
          { key: "author",   name: "Author",          required: true,  type: "single_line_text_field" }
          { key: "title",    name: "Title",           required: false, type: "single_line_text_field" }
          { key: "body",     name: "Review text",     required: false, type: "multi_line_text_field" }
          { key: "date",     name: "Date",            required: false, type: "date" }
          { key: "verified", name: "Verified buyer",  required: false, type: "boolean" }
          { key: "photo",    name: "Photo",           required: false, type: "file_reference" }
        ]
      }) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }`
  );
  const r = res.data.metaobjectDefinitionCreate;
  if (!r || !r.metaobjectDefinition) throw new Error("metaobjectDefinitionCreate: " + errStr(r?.userErrors));
  console.log("created metaobject definition 'review'");
}

async function ensureMetafieldDefinition(tok) {
  const def = await gql(tok, `{ metaobjectDefinitionByType(type: "review") { id } }`);
  const defId = def.data.metaobjectDefinitionByType?.id;
  if (!defId) throw new Error("review metaobject definition not found");

  // some API versions want the full gid, some the numeric id
  const attempts = [defId, defId.split("/").pop()];
  for (const value of attempts) {
    const res = await gql(
      tok,
      `mutation ($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id key }
          userErrors { field message }
        }
      }`,
      {
        definition: {
          name: "Reviews",
          namespace: "custom",
          key: "reviews",
          ownerType: "PRODUCT",
          description: "Reviews shown on the product page (list of review metaobjects).",
          type: "list.metaobject_reference",
          pin: true,
          validations: [{ name: "metaobject_definition_id", value }],
        },
      }
    );
    const r = res.data.metafieldDefinitionCreate;
    if (r?.createdDefinition) {
      console.log("created product metafield definition custom.reviews");
      return;
    }
    const msg = errStr(r?.userErrors);
    if (/already|taken|exists|in use/i.test(msg)) {
      console.log("product metafield definition custom.reviews already exists");
      return;
    }
    if (value === attempts[0]) continue;
    throw new Error("metafieldDefinitionCreate: " + msg);
  }
}

async function list(tok) {
  const p = await gql(
    tok,
    `{ products(first: 30) { nodes { title handle } } }`
  );
  console.log("title | handle");
  for (const n of p.data.products.nodes) console.log(`${n.title} | ${n.handle}`);
}

async function clean(tok) {
  const q = await gql(tok, `{ metaobjects(first: 100, type: "review") { nodes { id } } }`);
  const nodes = q.data.metaobjects.nodes;
  for (const n of nodes) {
    await gql(tok, `mutation ($id: ID!) { metaobjectDelete(id: $id) { deletedId } }`, { id: n.id });
  }
  console.log(`deleted ${nodes.length} review metaobjects`);
}

async function verify(tok) {
  const p = await gql(
    tok,
    `{
      products(first: 30) {
        nodes {
          title
          mf: metafield(namespace: "custom", key: "reviews") {
            references(first: 20) {
              nodes { ... on Metaobject { fields { key value } } }
            }
          }
        }
      }
    }`
  );
  for (const n of p.data.products.nodes) {
    const refs = n.mf?.references?.nodes || [];
    if (refs.length === 0) continue;
    console.log("== " + n.title);
    for (const r of refs) {
      const f = Object.fromEntries(r.fields.map((x) => [x.key, x.value]));
      console.log(`   ${f.rating}★ ${f.author} | ${f.title} | ${f.date} | verified=${f.verified}`);
    }
  }
}

(async () => {
  const tok = await token();
  if (LIST) {
    await list(tok);
    return;
  }
  if (CLEAN) {
    await clean(tok);
    return;
  }
  if (VERIFY) {
    await verify(tok);
    return;
  }
  await ensureMetaobjectDefinition(tok);
  await ensureMetafieldDefinition(tok);
  console.log("done — manage entries in Admin → Content → Metaobjects → Review");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
