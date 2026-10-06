import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { context, engine, ROOT, read } from "./test-support/theme-fixtures.js";

/**
 * Two classes of defect are covered here, both of which only show up on a store
 * whose content is not created yet:
 *
 * - a link the theme ships pointing at a collection or page that does not exist
 *   yet would render a 404 rather than degrade;
 * - a section that only has editor placeholders would publish grey blocks.
 *
 * The guards read the handle out of the configured value, so they hold whether
 * Shopify hands Liquid the raw shopify:// reference or the resolved path.
 */

const section = (settings) => ({ id: "template--1__guard", settings });

async function render(type, ctx, settings) {
  return engine(ctx).renderFile(`sections/${type}.liquid`, { ...ctx, section: section(settings) });
}

const withCollections = (ctx, collections) => ({ ...ctx, collections: { ...ctx.collections, ...collections } });
const withPages = (ctx, pages) => ({ ...ctx, pages: { ...ctx.pages, ...pages } });

test("the campaign banner falls back to the built-in all collection while all-products is missing", async () => {
  const ctx = context();
  const settings = { gallery_campaign: true, button_label: "Shop the collection", button_link: "shopify://collections/all-products" };

  const unresolved = await render("hero", ctx, settings);
  assert.match(unresolved, /href="\/collections\/all"/);
  assert.doesNotMatch(unresolved, /all-products/);

  // the resolved storefront-path form of the same setting must behave identically
  const resolved = await render("hero", ctx, { ...settings, button_link: "/collections/all-products" });
  assert.match(resolved, /href="\/collections\/all"/);

  const curated = await render("hero", withCollections(ctx, { "all-products": { url: "/collections/all-products" } }), settings);
  assert.match(curated, /href="\/collections\/all-products"/);
  assert.doesNotMatch(curated, /href="\/collections\/all"/, "an existing curated collection must not be overridden by the fallback");

  // a link the merchant typed by hand is not a store resource and must survive untouched
  const external = await render("hero", ctx, { ...settings, button_link: "https://partner.example/collections/prints" });
  assert.match(external, /href="https:\/\/partner\.example\/collections\/prints"/);
});

test("the our-approach button is suppressed until the our-story page exists", async () => {
  const ctx = context();
  const settings = { heading: "Our approach", button_label: "Read our story", button_link: "shopify://pages/our-story" };

  const unresolved = await render("image-with-text", ctx, settings);
  assert.doesNotMatch(unresolved, /<a\b/);
  assert.doesNotMatch(unresolved, /our-story/);
  assert.match(unresolved, /Our approach/, "the copy still renders, only the dead button is dropped");

  const linked = await render("image-with-text", withPages(ctx, { "our-story": { url: "/pages/our-story" } }), settings);
  assert.match(linked, /<a\s[^>]*href="\/pages\/our-story"/);

  const external = await render("image-with-text", ctx, { ...settings, button_link: "https://partner.example/pages/press" });
  assert.match(external, /<a\s[^>]*href="https:\/\/partner\.example\/pages\/press"/);
});

test("the journal section renders nothing on a storefront with no published article", async () => {
  const blank = await render("editorial", context(), { heading: "From the journal", blog: "journal", articles_count: 3 });
  assert.equal(blank.trim(), "", "no placeholder cards may reach a live storefront");

  const articles = [{ title: "Choosing art for a quiet room", url: "/blogs/journal/quiet-room", content: "x ".repeat(400), tags: [], image: null }];
  const published = await render("editorial", { ...context(), blogs: { journal: { url: "/blogs/journal", articles } } }, { heading: "From the journal", blog: "journal", articles_count: 3 });
  assert.match(published, /Choosing art for a quiet room/);
  assert.match(published, /href="\/blogs\/journal"/);
  assert.equal([...published.matchAll(/data-placeholder/g)].length, 0);

  // the theme editor still shows the placeholder so the section stays selectable
  const editor = await render("editorial", { ...context(), request: { design_mode: true } }, { heading: "From the journal", blog: "journal", articles_count: 3 });
  assert.equal([...editor.matchAll(/data-placeholder/g)].length, 3);
});

test("the canonical of the built-in all collection only points at an existing curated collection", () => {
  const layout = read("layout/theme.liquid");
  assert.doesNotMatch(layout, /append: '\/collections\/all-products'/, "a canonical must never hardcode a handle");
  assert.match(layout, /assign curated_collection = collections\['all-products'\]/);
  assert.match(layout, /if curated_collection != blank/);
  assert.match(layout, /append: curated_collection\.url/);
});

test("every page shares an image, falling back to the bundled brand asset", () => {
  const layout = read("layout/theme.liquid");
  assert.match(layout, /assign og_image_path = 'og-default\.webp' \| asset_url/);
  assert.match(layout, /assign og_image_src = 'https:' \| append: og_image_path/);
  assert.match(layout, /<meta name="twitter:image" content="\{\{ og_image_src \}\}">/);
  assert.ok(fs.existsSync(path.join(ROOT, "assets/og-default.webp")));
});
