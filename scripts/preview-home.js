/** Local-only homepage preview: the real theme templates rendered against synthetic
 * storefront data, so the site can be reviewed before a store exists.
 *
 * It never connects to the Shopify Admin API, creates orders, or changes the store.
 * It exists because `shopify theme dev` needs an authenticated store, and this project
 * deliberately has none until the merchant creates one.
 *
 * Scope: the homepage (templates/index.json) plus the real header and footer.
 * Collection, product, cart and search pages need far more storefront context — use
 * `pnpm preview:shopping` for the cart and wishlist.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, engine, parseJson, read } from "./test-support/theme-fixtures.js";

const PORT = Number(process.env.PREVIEW_PORT || 4174);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ---------------------------------------------------------------- fixtures */

const ART = {
  "all-products": "subject-abstract.webp",
  abstract: "subject-abstract.webp",
  landscapes: "subject-landscapes.webp",
  botanicals: "subject-botanicals.webp",
  figurative: "subject-figurative.webp",
  "still-life": "subject-still-life.webp",
  "living-room": "room-living-room.webp",
  bedroom: "room-bedroom.webp",
  "dining-room": "room-dining-room.webp",
  entryway: "room-entryway.webp",
  "new-arrivals": "subject-landscapes.webp",
  "best-sellers": "subject-botanicals.webp",
  "oversized-art": "craft-studio.webp",
};

const TITLES = {
  "all-products": "All paintings",
  abstract: "Abstract",
  landscapes: "Landscapes",
  botanicals: "Botanicals",
  figurative: "Figurative",
  "still-life": "Still Life",
  "living-room": "Living Room",
  bedroom: "Bedroom",
  "dining-room": "Dining Room",
  entryway: "Entryway",
  "new-arrivals": "New Arrivals",
  "best-sellers": "Best Sellers",
  "oversized-art": "Oversized Art",
};

const PRODUCT_SEED = [
  ["ember-horizon", "Ember Horizon – Neutral Abstract Wall Art", 8000, 12000, "subject-abstract.webp"],
  ["quiet-treeline", "Quiet Treeline – Muted Landscape Painting", 9200, 0, "subject-landscapes.webp"],
  ["dried-stems", "Dried Stems – Botanical Oil Study", 7600, 0, "subject-botanicals.webp"],
  ["seated-figure", "Seated Figure – Soft Figurative Canvas", 10800, 13400, "subject-figurative.webp"],
  ["ceramic-still-life", "Ceramic Still Life – Taupe Table Study", 8400, 0, "subject-still-life.webp"],
  ["olive-console", "Olive Console – Warm Neutral Room Scene", 6800, 0, "room-entryway.webp"],
  ["oak-platform", "Oak Platform – Calm Bedroom Scene", 12400, 0, "room-bedroom.webp"],
  ["studio-corner", "Studio Corner – Painter's Workspace", 9800, 0, "craft-studio.webp"],
];

const PRODUCTS = PRODUCT_SEED.map(([handle, title, price, compare, asset], i) => {
  const image = { id: 500 + i, alt: "master", width: 1122, height: 1402, aspect_ratio: 0.8, src: `/assets/${asset}` };
  return {
    id: 900 + i,
    handle,
    title,
    vendor: "CANVASRA",
    url: `/products/${handle}`,
    price,
    compare_at_price: compare,
    price_varies: false,
    available: i !== 3,
    options: ["Size", "Frame"],
    variants: [{ id: 901 + i, title: "40 × 20 cm / Oak frame", options: ["40 × 20 cm", "Oak frame"], price, available: true }],
    media: [image],
    images: [image.src],
    featured_media: image,
  };
});

const collection = (handle, title, products) => ({
  id: 2000 + Object.keys(TITLES).indexOf(handle),
  handle,
  title,
  url: `/collections/${handle}`,
  products_count: products.length,
  all_products_count: PRODUCTS.length,
  products,
  image: { alt: title, width: 1122, height: 842, src: `/assets/${ART[handle] ?? ART.abstract}` },
});
// The theme mixes two idioms: `section.settings.menu.links` (object) and
// `blogs[section.settings.blog]` / `linklists[services_menu]` (handle as a lookup key). Shopify
// resolves both, which is why setting coercion and a string form of each resource are both needed.
const withHandle = (obj, handle) => {
  Object.defineProperty(obj, "toString", { value: () => handle, enumerable: false, configurable: true });
  return obj;
};

const collections = Object.fromEntries(
  Object.keys(TITLES).map((handle) => [handle, withHandle(collection(handle, TITLES[handle], PRODUCTS), handle)]),
);
collections.all = withHandle(collection("all-products", "All paintings", PRODUCTS), "all");
collections.all.handle = "all";
collections.all.url = "/collections/all";

const ARTICLES = [
  ["How to choose art for a quiet room", "Interiors", "A room reads as calm when one thing is allowed to hold the eye. Here is how we think about scale, light and restraint when placing a painting."],
  ["Why we paint to order", "Studio", "Made-to-order is slower, and that is the point. Our artists work in oils over several days, layering colour until the surface holds depth."],
  ["Bringing warmth into a neutral space", "Colour", "Neutral rooms are not colourless. The palette we return to most often leans on cream, taupe and a single muted accent."],
  ["Framing: oak, walnut or black", "Craft", "The frame is the last decision and often the loudest. A short guide to matching moulding to the artwork rather than the sofa."],
].map(([title, tag, body], i) => ({
  id: 700 + i,
  title,
  handle: `journal-${i + 1}`,
  url: `/blogs/journal/journal-${i + 1}`,
  tags: [tag],
  content: `<p>${body}</p>`,
  excerpt_or_content: body,
  image: { alt: title, width: 1122, height: 842, src: `/assets/${ART.abstract}` },
}));

const pages = Object.fromEntries(
  [
    ["our-story", "Our Story"],
    ["our-approach", "Our Approach"],
    ["materials-craft", "Materials & Craft"],
    ["contact", "Contact"],
    ["custom-painting", "Custom Painting"],
    ["wishlist", "Wishlist"],
  ].map(([handle, title]) => [handle, withHandle({ handle, title, url: `/pages/${handle}` }, handle)]),
);

const link = (title, url, links) => ({ title, url, links: links || [] });

const linklists = {
  "main-menu": withHandle(link("Main menu", "/", [
    link("Shop", "/collections/all-products", [
      link("Abstract", "/collections/abstract"),
      link("Landscapes", "/collections/landscapes"),
      link("Botanicals", "/collections/botanicals"),
      link("Figurative", "/collections/figurative"),
    ]),
    link("Rooms", "/collections", [
      link("Living Room", "/collections/living-room"),
      link("Bedroom", "/collections/bedroom"),
      link("Dining Room", "/collections/dining-room"),
      link("Entryway", "/collections/entryway"),
    ]),
    link("Journal", "/blogs/journal"),
    link("About", "/pages/our-story"),
  ]), "main-menu"),
  footer: withHandle(link("Footer menu", "/", [
    link("Shipping", "/policies/shipping-policy"),
    link("Returns", "/policies/refund-policy"),
    link("Contact", "/pages/contact"),
    link("Size guide", "/pages/contact"),
  ]), "footer"),
};

const blogs = {
  journal: withHandle(
    { handle: "journal", title: "Journal", url: "/blogs/journal", articles: ARTICLES, all_tags: ["Interiors", "Studio", "Colour", "Craft"] },
    "journal",
  ),
};

const routes = {
  root_url: "/",
  cart_url: "/cart",
  cart_add_url: "/cart/add",
  cart_change_url: "/cart/change",
  cart_update_url: "/cart/update",
  account_url: "/account",
  search_url: "/search",
  predictive_search_url: "/search/suggest",
  all_products_collection_url: "/collections/all",
  collections_url: "/collections",
};

const settings = {
  brand_name: "CANVASRA",
  enable_display_currency: true,
  enable_customer_reviews: false,
  free_shipping_threshold: 0,
};

function buildContext() {
  const frameTextures = Object.fromEntries(
    ["oak", "black", "walnut", "white", "gold", "silver"].map((k) => [k, `/assets/frame-${k}.webp`]),
  );
  return {
    settings,
    routes,
    theme: {
      moneyFormat: "${{amount}}",
      routes: { root: "/", cart: "/cart", cartAdd: "/cart/add", cartChange: "/cart/change", search: "/search", predictiveSearch: "/search/suggest" },
      frameTextures,
      displayCurrencyConfig: { enabled: true, country: "US", locale: "en", rates: { EUR: 0.92, GBP: 0.79, CNY: 7.2 } },
    },
    shop: { name: "CANVASRA", money_format: "${{amount}}", description: "Hand-painted original art for considered spaces." },
    request: { page_type: "index", design_mode: false, origin: ORIGIN, path: "/", locale: { iso_code: "en" } },
    localization: { country: { iso_code: "US" } },
    cart: { items: [], item_count: 0, total_price: 0, currency: { iso_code: "USD" } },
    customer: null,
    collections,
    pages,
    blogs,
    linklists,
    articles: ARTICLES,
    all_products: PRODUCTS,
    current_page: 1,
    template: { name: "index", suffix: null },
    page_title: "Original art, painted by hand",
    page_description: "Hand-painted original art for considered spaces.",
    page_image: null,
    canonical_url: `${ORIGIN}/`,
    content_for_header: "",
  };
}

/* ---------------------------------------------------------------- rendering */

/** Shopify resolves typed settings before Liquid ever sees them: an image_picker stored as ""
 * becomes nil, and a collection/blog/page/link_list stored as a handle becomes the object itself.
 * Without this the theme's `if section.settings.image` guards would take the wrong branch
 * (liquidjs, like Liquid, treats "" as truthy) and every collection-backed section would look
 * empty. The section's own {% schema %} is the authority on each setting's type. */
const SCHEMAS = new Map();
function schemaFor(sectionType) {
  if (SCHEMAS.has(sectionType)) return SCHEMAS.get(sectionType);
  const source = read(`sections/${sectionType}.liquid`);
  const raw = source.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/)?.[1];
  const schema = raw ? JSON.parse(raw) : {};
  const types = {
    section: new Map((schema.settings || []).map((setting) => [setting.id, setting.type])),
    blocks: new Map((schema.blocks || []).map((block) => [block.type, new Map((block.settings || []).map((setting) => [setting.id, setting.type]))])),
  };
  SCHEMAS.set(sectionType, types);
  return types;
}

function coerce(type, value) {
  const blank = value === "" || value === null || value === undefined;
  switch (type) {
    case "image_picker":
    case "video":
    case "video_url":
      return blank ? null : value;
    case "collection":
      return blank ? null : collections[value] ?? null;
    case "blog":
      return blank ? null : blogs[value] ?? null;
    case "page":
      return blank ? null : pages[value] ?? null;
    case "link_list":
      return blank ? null : linklists[value] ?? null;
    default:
      return value;
  }
}

const resolveSettings = (types, settings = {}) =>
  Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, coerce(types.get(key), value)]));

async function renderAll() {
  const ctx = buildContext();
  const liquid = engine(ctx);
  const template = parseJson("templates/index.json");
  const sectionsData = parseJson("config/settings_data.json").current.sections;

  const renderSection = async (type, secSettings = {}, blocks = []) => {
    const types = schemaFor(type);
    const section = { id: `preview--${type}`, settings: resolveSettings(types.section, secSettings), blocks };
    const html = await liquid.renderFile(`sections/${type}.liquid`, { ...ctx, section });
    return `<div id="shopify-section-${section.id}" class="shopify-section">${html}</div>`;
  };

  const blocksFor = (type, section = {}) => {
    const types = schemaFor(type);
    return (section.block_order || []).map((key) => {
      const block = section.blocks[key];
      return { ...block, id: key, settings: resolveSettings(types.blocks.get(block.type), block.settings) };
    });
  };

  // Same composition order as layout/theme.liquid. The announcement bar is skipped there
  // too (the merchant disabled it and the markup is merely retained), so the preview matches.
  const parts = [];
  parts.push(await renderSection("header", sectionsData.header.settings));
  for (const id of template.order) {
    const section = template.sections[id];
    parts.push(await renderSection(section.type, section.settings, blocksFor(section.type, section)));
  }
  parts.push(await renderSection("footer", sectionsData.footer.settings));
  parts.push(await renderSection("cart-drawer"));

  const fontCss = [".shopify/verification/font-face.css", ".shopify/preview/font-face.css"]
    .map((p) => path.join(ROOT, p))
    .find((p) => fs.existsSync(p));

  return `<!doctype html>
<html lang="en" class="js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Local preview — Canvasra homepage</title>
<link rel="icon" type="image/png" href="/assets/favicon-canvasra.png">
<link rel="stylesheet" href="/assets/theme.css">
${fontCss ? `<style>${fs.readFileSync(fontCss, "utf8")}</style>` : ""}
<script>window.theme = ${JSON.stringify(ctx.theme)};</script>
<script src="/assets/utils.js" defer></script>
<script src="/assets/display-currency.js" defer></script>
</head>
<body class="bg-white text-black home-immersive">
<a class="sr-only focus:not-sr-only" href="#MainContent">Skip to content</a>
${parts.join("\n")}
</body>
</html>`;
}

/* ------------------------------------------------------------------- server */

const MIME = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, ORIGIN);
  const send = (status, body, type = "text/html; charset=utf-8") => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  };
  try {
    if (url.pathname.startsWith("/assets/")) {
      const filename = path.resolve(ROOT, "." + decodeURIComponent(url.pathname));
      if (!filename.startsWith(path.resolve(ROOT, "assets") + path.sep) || !fs.existsSync(filename)) return send(404, "Not found");
      return send(200, fs.readFileSync(filename), MIME[path.extname(filename)] || "application/octet-stream");
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return send(200, await renderAll());
    return send(404, `<!doctype html><meta charset="utf-8"><body style="font:15px/1.7 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;padding:44px;max-width:640px;margin:0 auto;color:#1b1a18">
      <h1 style="font-weight:600;font-size:19px">本地预览只覆盖首页</h1>
      <p>这个预览用合成数据渲染 <code>templates/index.json</code> 与真实的页头页脚，因此只有首页可见。</p>
      <p>集合页、商品页、搜索页需要完整的店铺上下文，要等店铺建好后用 <code>shopify theme dev</code> 看；
      购物车与心愿单页可用 <code>pnpm preview:shopping</code>（端口 4173）预览。</p>
      <p><a href="/">← 回到首页预览</a></p>
    </body>`);
  } catch (error) {
    console.error(error);
    send(500, `<pre style="font:13px/1.6 ui-monospace,Menlo,monospace;padding:24px;white-space:pre-wrap">${String(error?.stack || error)}</pre>`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Canvasra homepage preview: ${ORIGIN}/`);
  console.log("Local fixture data only — nothing is sent to Shopify.");
});
