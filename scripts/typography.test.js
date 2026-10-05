import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";
import { context, engine, product, read, ROOT, renderSection } from "./test-support/theme-fixtures.js";

const files = ["sections", "snippets"].flatMap(dir => fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith(".liquid")).map(file => `${dir}/${file}`));

test("monospace is reserved for short editorial labels, never product controls or body copy", () => {
  let remaining = 0;
  for (const file of files) {
    for (const line of read(file).split("\n").filter(line => /class="[^"]*font-mono/.test(line))) {
      remaining++;
      assert.match(line, /<p\b/, file);
      assert.ok(line.includes("uppercase") || line.includes("section.settings.eyebrow"), `${file}: unexpected monospace text`);
      assert.match(line, /text-\[12px\]/, file);
    }
  }
  assert.ok(remaining > 0 && remaining <= 20);
  for (const file of ["assets/predictive-search.js", "assets/wishlist-page.js"]) assert.doesNotMatch(read(file), /font-mono/);
});

test("product cards have a serif title, readable sans-serif description and prominent starting price", async () => {
  const html = await engine().renderFile("product-card", { ...context(), product: { ...product(), price_varies: true } });
  const details = parseHTML(html).document.querySelector(".space-y-1");
  const title = details.querySelector("a");
  const [description, price] = details.querySelectorAll("p");
  assert.ok(title.classList.contains("font-serif"));
  assert.ok(title.classList.contains("text-[19px]"));
  assert.ok(description.classList.contains("font-sans"));
  assert.ok(description.classList.contains("text-[14px]"));
  assert.ok(price.classList.contains("font-sans"));
  assert.ok(price.classList.contains("text-[16px]"));
  assert.equal(price.textContent.trim(), "From $80.00");
});

test("page prose and product descriptions use 16px sans-serif with generous line spacing", async () => {
  const html = await renderSection("main-page", { ...context(), page: { title: "Our story", content: "<p>Hand-painted art.</p>" } });
  const prose = parseHTML(html).document.querySelector(".rte");
  assert.ok(prose.classList.contains("font-sans"));
  assert.ok(prose.classList.contains("text-[16px]"));
  assert.ok(prose.classList.contains("leading-[1.8]"));
  const pdp = read("sections/main-product.liquid");
  assert.equal([...pdp.matchAll(/space-y-4 pb-6 font-sans text-\[16px\] leading-\[1\.75\]/g)].length, 2);
  assert.match(pdp, /font-sans text-\[20px\] leading-\[1\.4\]/);
});

test("form inputs remain at least 16px and the size guide no longer uses tiny monospace pills", () => {
  for (const file of files) {
    const source = read(file);
    for (const tag of source.matchAll(/<(?:input|textarea|select)\b[^>]*class="([^"]*)"[^>]*>/gs)) {
      const classes = tag[1];
      if (!classes.includes("font-sans")) continue;
      const sizes = [...classes.matchAll(/(?:^|\s)(?:\w+:)?text-\[([\d.]+)px\]/g)].map(match => Number(match[1]));
      assert.ok(sizes.every(size => size >= 16), `${file}: small input typography`);
    }
  }
  const pill = read("src/theme.css").match(/\.sg-pill \{([^}]+)\}/)[1];
  assert.match(pill, /font-family: var\(--font-sans\)/);
  assert.match(pill, /font-size: 14px/);
});

test("tablet navigation collapses before the larger text can overlap the logo", async () => {
  const html = await renderSection("header", context(), { menu: { links: [{ title: "Shop", url: "/collections/all" }] } });
  const document = parseHTML(html).document;
  assert.ok(document.querySelector("[data-drawer-open]").classList.contains("xl:hidden"));
  assert.ok(document.querySelector("header nav").classList.contains("xl:flex"));
  for (const selector of ["[data-drawer-overlay]", "[data-drawer-panel]"]) {
    assert.ok(document.querySelector(selector).classList.contains("xl:hidden"));
  }
});

test("dynamic cards share the same typography scale as Liquid cards", () => {
  for (const file of ["assets/predictive-search.js", "assets/wishlist-page.js"]) {
    const source = read(file);
    assert.match(source, /font-serif text-\[19px\] leading-\[1\.3\]/);
    assert.match(source, /font-sans text-\[14px\] leading-\[1\.5\] text-neutral-600/);
    assert.match(source, /font-sans text-\[16px\] font-medium leading-\[1\.5\] text-black/);
  }
});
