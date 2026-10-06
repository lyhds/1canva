/** Offline fixtures render the actual Liquid, CSS and browser scripts.
 * Shopify-only metadata tags are omitted; this is not a Shopify API emulator.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Liquid } from "liquidjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
export const parseJson = (name) => JSON.parse(read(name).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
const translations = parseJson("locales/en.default.json");
const stripMetadata = (source) => source
  .replace(/{%-?\s*(schema|doc)\s*-?%}[\s\S]*?{%-?\s*end\1\s*-?%}/g, "")
  .replace(/{%-?\s*(?:paginate\s+[^%]+|endpaginate)\s*-?%}/g, "");

export function engine(globals = {}) {
  const templates = {};
  for (const directory of ["sections", "snippets"]) {
    for (const name of fs.readdirSync(path.join(ROOT, directory)).filter((name) => name.endsWith(".liquid"))) {
      templates[`${directory}/${name}`] = stripMetadata(read(`${directory}/${name}`));
      if (directory === "snippets") templates[name.slice(0, -7)] = templates[`${directory}/${name}`];
    }
  }
  const liquid = new Liquid({ templates, strictFilters: true, globals });
  liquid.registerFilter("t", (key, ...args) => {
    const values = Object.fromEntries(args);
    const text = key.split(".").reduce((value, part) => value?.[part], translations);
    if (typeof text !== "string") throw new Error(`Missing translation: ${key}`);
    return text.replace(/{{\s*(\w+)\s*}}/g, (_, name) => values[name] ?? "");
  });
  liquid.registerFilter("money", (value) => `$${(Number(value) / 100).toFixed(2)}`);
  liquid.registerFilter("money_without_currency", (value) => (Number(value) / 100).toFixed(2));
  liquid.registerFilter("money_with_currency", (value) => `$${(Number(value) / 100).toFixed(2)} USD`);
  liquid.registerFilter("asset_url", (name) => `/assets/${name}`);
  liquid.registerFilter("asset_img_url", (name) => `/assets/${name}`);
  liquid.registerFilter("image_url", (image) => typeof image === "string" ? image : image?.src);
  // Presentation-only stand-in so sections that show an editor placeholder can render offline.
  liquid.registerFilter("placeholder_svg_tag", (name, className) => `<svg class="${className}" data-placeholder="${name}"></svg>`);
  // Shopify's {% form %} tag has no liquidjs equivalent, which is why sections carrying one
  // (footer's newsletter, the account/contact flows) could never be rendered offline. The stub
  // emits a non-submitting element and keeps the block body so the markup and its styling
  // stay reviewable. It never posts anywhere.
  liquid.registerTag("form", {
    parse(tagToken, remainTokens) {
      this.className = tagToken.args.match(/class:\s*'([^']*)'/)?.[1] ?? "";
      this.templates = [];
      const stream = this.liquid.parser.parseStream(remainTokens);
      stream
        .on("tag:endform", () => stream.stop())
        .on("template", (template) => this.templates.push(template))
        .on("end", () => {
          throw new Error("{% form %} was never closed with {% endform %}");
        });
      stream.start();
    },
    *render(ctx, emitter) {
      emitter.write(`<form method="post" action="#" class="${this.className}" data-offline-form>`);
      yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter);
      emitter.write("</form>");
    },
  });
  return liquid;
}

export function product(handle = "ember-horizon-neutral-abstract-wall-art", id = 101) {
  const image = {
    id, alt: "master", width: 1600, height: 800, aspect_ratio: 2,
    src: "https://cdn.shopify.com/s/files/1/0764/2035/0006/files/ember-horizon-1.png?v=1788442062",
  };
  return {
    id, handle, title: "Ember Horizon – Neutral Abstract Wall Art", vendor: "CANVASRA",
    url: `/products/${handle}`, price: 8000, available: true,
    options: ["Size", "Frame"], variants: [{ id: 901, options: ["40 × 20 cm", "Oak frame"], price: 8000 }],
    media: [image], images: [image.src], featured_media: image,
  };
}

export function line(key = "901:original", quantity = 1, painting = product()) {
  return {
    key, quantity, product: painting, variant: painting.variants[0], image: painting.media[0],
    url: `${painting.url}?variant=901`, title: `${painting.title} - 40 × 20 cm / Oak frame`,
    final_line_price: quantity * 8000,
  };
}

export function context(items = [line()], root = "/") {
  const wishlist = { title: "Wishlist", url: `${root}pages/wishlist` };
  return {
    cart: { items, item_count: items.reduce((sum, item) => sum + item.quantity, 0), total_price: items.reduce((sum, item) => sum + item.final_line_price, 0) },
    settings: { brand_name: "CANVASRA", free_shipping_threshold: 0 },
    routes: { root_url: root, cart_url: `${root}cart`, cart_add_url: `${root}cart/add`, cart_change_url: `${root}cart/change`, account_url: `${root}account`, search_url: `${root}search`, all_products_collection_url: `${root}collections/all` },
    pages: { wishlist }, page: wishlist, collections: { all: { products: [product()] } },
  };
}

export async function renderSection(type, ctx = context(), settings = {}, blocks = []) {
  const section = { id: `template--22435099082806__${type}`, settings, blocks };
  const html = await engine(ctx).renderFile(`sections/${type}.liquid`, { ...ctx, section });
  return `<div id="shopify-section-${section.id}" class="shopify-section">${html}</div>`;
}

export async function renderPage(type, ctx = context(), { messages = false } = {}) {
  const announcement = parseJson("config/settings_data.json").current.sections["announcement-bar"].settings;
  const blocks = messages ? [
    { settings: { text: "Hand-painted to order", link: "#MainContent" } },
    { settings: { text: announcement.text, link: "#MainContent" } },
  ] : [];
  const theme = { moneyFormat: "${{amount}}", routes: { root: ctx.routes.root_url, cart: ctx.routes.cart_url, cartChange: ctx.routes.cart_change_url }, frameTextures: { oak: "/assets/frame-oak.webp", black: "/assets/frame-black.webp", walnut: "/assets/frame-walnut.webp" } };
  const nav = { links: [{ title: "Shop", url: "/collections/all" }, { title: "Collections", url: "/collections" }, { title: "Journal", url: "/blogs/journal" }, { title: "About", url: "/pages/our-story" }] };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local verification — ${type}</title><link rel="stylesheet" href="/assets/theme.css"><script>window.theme=${JSON.stringify(theme)};</script><script src="/assets/utils.js" defer></script></head><body class="bg-white text-black">
    ${await renderSection("announcement-bar", ctx, announcement, blocks)}
    ${await renderSection("header", ctx, { menu: nav })}
    <main id="MainContent">${await renderSection(type, ctx)}</main></body></html>`;
}
