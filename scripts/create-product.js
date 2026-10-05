/**
 * Create & publish a painting product via the Admin API (2025-07).
 *
 * Usage:
 *   node scripts/create-product.js --dir "<image folder>" --title "<title>" \
 *     --master "<filename of artwork master>" [--tags a,b,c] \
 *     [--m-price 100] [--vendor "CANVASRA"] [--publish]
 *
 * The folder's images upload in this order: master first (alt "master"),
 * then every other image alphabetically (gallery shots). The Size option
 * values are the real canvas dimensions, derived from the master image's
 * aspect ratio through this script's own retired five-size ladder (not the
 * six catalog ratios the current theme and Product Studio use);
 * pricing follows the SOP tiers by size position. Inventory is
 * made-to-order (policy CONTINUE, no stock cap).
 *
 * Writes require BOTH --allow-legacy and --apply. Without --apply the script
 * prints the plan (target sizes, variant count, upload list, status) and exits
 * without reading credentials or calling Shopify. A successful productSet is
 * read back and compared before the script reports success.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const USAGE = `LEGACY: five-size / four-frame creator. Not for the current catalog.
See docs/PRODUCT_IMAGE_RULES.md. Writes require --allow-legacy AND --apply.

Usage:
  node scripts/create-product.js --dir <folder> --title <title> --master <file> [options]

Options:
  --tags <a,b>       Product tags (default: col-abstract)
  --m-price <amount> Base price for size M (default: 100)
  --vendor <name>    Product vendor (default: CANVASRA)
  --publish          Publish the product to the Online Store channel
  --allow-legacy     Explicitly permit the retired product schema
  --apply            Write to Shopify; without it the script prints a plan only
  -h, --help         Show this help without connecting to Shopify`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

const knownOptions = new Set(["--dir", "--title", "--master", "--tags", "--m-price", "--vendor", "--publish", "--allow-legacy", "--apply"]);
const unknownOption = args.find((value) => value.startsWith("--") && !knownOptions.has(value));
if (unknownOption) {
  console.error(`Unknown option: ${unknownOption}\n\n${USAGE}`);
  process.exit(1);
}

const DIR = arg("dir");
const TITLE = arg("title");
const MASTER = arg("master");
const TAGS = (arg("tags", "col-abstract") || "").split(",").map((t) => t.trim()).filter(Boolean);
const M_PRICE = arg("m-price", "100");
const VENDOR = arg("vendor", "CANVASRA");
const PUBLISH = args.includes("--publish");

if (!DIR || !TITLE || !MASTER) {
  console.error(USAGE);
  process.exit(1);
}
if (!Number.isFinite(Number(M_PRICE)) || Number(M_PRICE) <= 0) {
  console.error("--m-price must be a positive number.");
  process.exit(1);
}

if (!args.includes('--allow-legacy')) {
  console.error('Legacy product creation blocked. Read docs/PRODUCT_IMAGE_RULES.md; use --allow-legacy only for intentional historical-schema work.');
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

const FRAMES = ["Oak frame", "Black frame", "Walnut frame", "No frame"];
const TIER_MULT = [0.8, 1, 1.4, 2, 2.8];
const tierPrice = (i) => (TIER_MULT[i] * Number(M_PRICE)).toFixed(2);
const ASPECT_CANDIDATES = [["34", 0.75], ["portrait", 0.8], ["square", 1.0], ["landscape", 1.5], ["21", 2.0]];
const DIMS = {
  "34": ["30 × 40 cm", "45 × 60 cm", "60 × 80 cm", "75 × 100 cm", "90 × 120 cm"],
  portrait: ["30 × 40 cm", "40 × 50 cm", "50 × 70 cm", "70 × 100 cm", "100 × 150 cm"],
  square: ["30 × 30 cm", "40 × 40 cm", "50 × 50 cm", "70 × 70 cm", "100 × 100 cm"],
  landscape: ["40 × 30 cm", "50 × 40 cm", "70 × 50 cm", "100 × 70 cm", "150 × 100 cm"],
  "21": ["40 × 20 cm", "60 × 30 cm", "80 × 40 cm", "100 × 50 cm", "150 × 75 cm"],
};

/** Read pixel dimensions of a local PNG/JPEG/WebP file (no dependencies). */
function imageSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}

function aspectOf(width, height) {
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

(async () => {
  // images: master first, remaining files alphabetically
  const files = fs.readdirSync(DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const ordered = [MASTER, ...files.filter((f) => f !== MASTER).sort()];
  for (const f of ordered) {
    if (!fs.existsSync(path.join(DIR, f))) {
      console.error("missing file:", f);
      process.exit(1);
    }
  }

  // Size values = real dimensions, derived from the master image's aspect ratio
  const masterDims = imageSize(path.join(DIR, MASTER));
  if (!masterDims) {
    console.error("cannot read master image dimensions (png/jpg/webp only):", MASTER);
    process.exit(1);
  }
  const aspect = aspectOf(masterDims.width, masterDims.height);
  const SIZE_VALUES = DIMS[aspect];
  console.log(`master: ${masterDims.width}x${masterDims.height} -> aspect ${aspect}`);
  console.log(`sizes: ${SIZE_VALUES.join(" / ")}`);

  // Plan only until --apply: no token is requested and no Shopify request is
  // made. (The .env file is parsed at module load, so its keys must exist.)
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({
      mode: "plan",
      title: TITLE,
      vendor: VENDOR,
      tags: TAGS,
      status: "ACTIVE",
      publish: PUBLISH,
      aspect,
      sizes: SIZE_VALUES,
      frames: FRAMES,
      variants: SIZE_VALUES.length * FRAMES.length,
      uploads: ordered,
    }, null, 2));
    console.log("Plan only: nothing was created. Re-run with --allow-legacy --apply to write.");
    process.exit(0);
  }

  const tok = await token();

  // 1. staged uploads (batch list call -> StagedMediaUploadTarget with resourceUrl)
  const r0 = await gql(tok,
    `mutation ($inputs: [StagedUploadInput!]!) { stagedUploadsCreate(input: $inputs) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    { inputs: ordered.map((f) => ({
        resource: "IMAGE",
        filename: f,
        mimeType: /\.(jpe?g)$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : "image/png",
        httpMethod: "POST",
        fileSize: String(fs.statSync(path.join(DIR, f)).size),
      })) }
  );
  if (r0.data.stagedUploadsCreate.userErrors.length) {
    console.log("STAGED ERRORS:", JSON.stringify(r0.data.stagedUploadsCreate.userErrors));
    process.exit(1);
  }
  const targets = r0.data.stagedUploadsCreate.stagedTargets;

  // 2. upload files
  const staged = [];
  for (let i = 0; i < ordered.length; i++) {
    const t = targets[i];
    const form = new FormData();
    for (const p of t.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([fs.readFileSync(path.join(DIR, ordered[i]))]), ordered[i].replace(/[^\w.-]+/g, "_"));
    const up = await fetch(t.url, { method: "POST", body: form });
    console.log("uploaded:", ordered[i], "status", up.status);
    staged.push({ resourceUrl: t.resourceUrl, alt: i === 0 ? "master" : TITLE });
  }

  // 3. variants: Size outer, Frame inner; made-to-order (CONTINUE);
  //    price follows the SOP tier multiplier by size position
  const variants = [];
  for (const [i, size] of SIZE_VALUES.entries()) {
    for (const fr of FRAMES) {
      variants.push({
        optionValues: [
          { optionName: "Size", name: size },
          { optionName: "Frame", name: fr },
        ],
        price: tierPrice(i),
        inventoryPolicy: "CONTINUE",
      });
    }
  }

  // 4. productSet
  const description = `<p>Hand-painted in oils on premium linen canvas and framed to order. ${TITLE.split("–")[0].trim()} ships ready to hang — the framed preview on this page reflects the exact painting you will receive.</p>`;
  const r = await gql(tok,
    `mutation productSet($input: ProductSetInput!) {
      productSet(input: $input) {
        product { id title handle status options { name values } variants(first: 30) { nodes { title price } } }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title: TITLE,
        descriptionHtml: description,
        vendor: VENDOR,
        tags: TAGS,
        status: "ACTIVE",
        productOptions: [
          { name: "Size", values: SIZE_VALUES.map((name) => ({ name })) },
          { name: "Frame", values: FRAMES.map((name) => ({ name })) },
        ],
        variants,
        files: staged.map((s, i) => ({
          originalSource: s.resourceUrl,
          contentType: "IMAGE",
          alt: s.alt,
          filename: `img-${i + 1}${path.extname(ordered[i])}`,
        })),
      },
    }
  );
  const ps = r.data.productSet;
  if (ps.userErrors.length) {
    console.log("USER ERRORS:", JSON.stringify(ps.userErrors, null, 1));
    process.exit(1);
  }
  const product = ps.product;
  console.log("product:", product.id, product.handle, product.status);
  console.log("variants:", product.variants.nodes.length);

  // 5. read back the created product before reporting success
  const readback = await gql(tok,
    `query ($id: ID!) { product(id: $id) {
      id title handle status
      options { name values }
      variants(first: 100) { nodes { title } }
      media(first: 30) { nodes { alt status } }
    } }`,
    { id: product.id }
  );
  const saved = readback.data.product;
  const problems = [];
  if (!saved) {
    problems.push("product not found");
  } else {
    if (saved.title !== TITLE) problems.push(`title "${saved.title}" != "${TITLE}"`);
    if (saved.status !== "ACTIVE") problems.push(`status ${saved.status}`);
    const savedVariants = saved.variants?.nodes?.length ?? 0;
    if (savedVariants !== variants.length) problems.push(`variants ${savedVariants} != ${variants.length}`);
    const savedSizes = saved.options?.find((option) => option.name === "Size")?.values ?? [];
    if (savedSizes.join("|") !== SIZE_VALUES.join("|")) problems.push(`sizes ${savedSizes.join("|")}`);
    const savedFrames = saved.options?.find((option) => option.name === "Frame")?.values ?? [];
    if (savedFrames.join("|") !== FRAMES.join("|")) problems.push(`frames ${savedFrames.join("|")}`);
    const media = saved.media?.nodes ?? [];
    if (media.length !== ordered.length) problems.push(`media ${media.length} != ${ordered.length}`);
    else if (media[0]?.alt !== "master") problems.push(`first media alt "${media[0]?.alt}"`);
    // Shopify processes media asynchronously; report it instead of failing a created product
    const processing = media.filter((m) => m.status !== "READY");
    if (processing.length) console.log(`readback: ${processing.length} media still processing (${processing.map((m) => m.status).join(", ")})`);
  }
  if (problems.length) {
    console.error("READBACK MISMATCH:", problems.join("; "));
    process.exit(1);
  }
  console.log("readback: verified", saved.media?.nodes?.length ?? 0, "media,", saved.variants?.nodes?.length ?? 0, "variants");

  // 6. publish to Online Store (API-created products are channel-unpublished)
  if (PUBLISH) {
    const pubs = await gql(tok, `query { publications(first: 10) { nodes { id name } } }`);
    const osPub = pubs.data.publications.nodes.find((p) => /online store/i.test(p.name));
    const pr = await gql(tok,
      `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { publishable { ... on Product { id handle } } userErrors { field message } }
      }`,
      { id: product.id, input: [{ publicationId: osPub.id }] }
    );
    const pub = pr.data.publishablePublish;
    if (pub.userErrors.length) {
      console.log("PUBLISH ERRORS:", JSON.stringify(pub.userErrors));
      process.exit(1);
    }
    console.log("published to:", osPub.name);
    const publishedBack = await gql(tok,
      `query ($id: ID!) { product(id: $id) { resourcePublications(first: 10) { nodes { isPublished publication { name } } } } }`,
      { id: product.id }
    );
    const live = (publishedBack.data.product?.resourcePublications?.nodes || [])
      .some((node) => node.isPublished && node.publication?.name === osPub.name);
    if (!live) {
      console.error(`PUBLISH READBACK: ${osPub.name} publication not confirmed`);
      process.exit(1);
    }
    console.log("readback: published to", osPub.name);
  }
})();
