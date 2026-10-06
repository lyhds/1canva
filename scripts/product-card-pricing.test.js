import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { context, engine, product, renderPage, read } from "./test-support/theme-fixtures.js";
import { browserDom, settle } from "./test-support/browser-dom.js";
import vm from "node:vm";

const cases = [
  { name: "different variant prices", price: 8000, max: 28000, varies: true, expected: "From $80.00" },
  { name: "same-price variants", price: 8000, max: 8000, varies: false, expected: "$80.00" },
  { name: "fixed-price product", price: 29900, max: 29900, varies: false, expected: "$299.00" },
  { name: "zero minimum", price: 0, max: 8000, varies: true, expected: "From $0.00" },
];

for (const c of cases) {
  const painting = { ...product(), price: c.price, price_min: c.price, price_max: c.max, price_varies: c.varies };
  test(`Liquid cards: ${c.name}`, async () => {
    const html = await engine().renderFile("product-card", { ...context(), product: painting });
    const { document } = parseHTML(html);
    assert.equal(document.querySelector(".space-y-1 > p:last-child").textContent.trim(), c.expected);
  });

  test(`wishlist cards: ${c.name}`, async () => {
    const dom = browserDom(await renderPage("main-wishlist"), {
      saved: [painting.handle], fetch: async () => ({ ok: true, json: async () => painting }),
    });
    dom.run("utils.js");
    dom.run("wishlist.js");
    dom.run("wishlist-page.js");
    await settle();
    assert.equal(dom.document.querySelector("[data-wishlist-card] .space-y-1 > p:last-child").textContent, c.expected);
  });

  test(`predictive search cards: ${c.name}`, () => {
    const { document } = parseHTML("<div id='results'></div>");
    let Search;
    const scope = vm.createContext({
      HTMLElement: class {},
      customElements: { get() {}, define(_name, constructor) { Search = constructor; } },
      window: { theme: { formatMoney: cents => `$${(cents / 100).toFixed(2)}`, escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;") } },
    });
    vm.runInContext(read("assets/predictive-search.js"), scope);
    const search = new Search();
    search.dataset = { fromPrice: "From __PRICE__", viewAll: "View all" };
    search.results = document.querySelector("#results");
    search.render([{ ...painting, price: (c.price / 100).toFixed(2), price_min: (c.price / 100).toFixed(2), price_max: (c.max / 100).toFixed(2) }], "art");
    assert.equal(search.results.querySelector("a > p:last-child").textContent, c.expected);
  });
}

test("Liquid cards show strikethrough compare-at while on sale", async () => {
  const painting = { ...product(), price: 8000, price_min: 8000, price_max: 28000, price_varies: true, compare_at_price: 20000 };
  const html = await engine().renderFile("product-card", { ...context(), product: painting });
  const { document } = parseHTML(html);
  const p = document.querySelector(".space-y-1 > p:last-child");
  assert.equal(p.querySelector("s [data-display-money]").dataset.cents, "20000");
  assert.match(p.textContent.trim(), /-60%$/, "discount badge should render after the price");
  assert.equal(p.textContent.trim().replace(/-\d+%$/, "").trim(), "$200.00 From $80.00");
});

test("wishlist cards show strikethrough compare-at from variant prices", async () => {
  const painting = { ...product(), price: 8000, variants: [{ id: 901, options: ["40 × 20 cm", "Oak frame"], price: 8000, compare_at_price: 20000 }] };
  const dom = browserDom(await renderPage("main-wishlist"), {
    saved: [painting.handle], fetch: async () => ({ ok: true, json: async () => painting }),
  });
  for (const script of ["utils.js", "wishlist.js", "wishlist-page.js"]) dom.run(script);
  await settle();
  const p = dom.document.querySelector("[data-wishlist-card] .space-y-1 > p:last-child");
  assert.ok(p.querySelector("s"));
  assert.equal(p.textContent.trim(), "$200.00 $80.00");
});

test("predictive search cards show strikethrough compare-at when provided", () => {
  const { document } = parseHTML("<div id='results'></div>");
  let Search;
  const scope = vm.createContext({
    HTMLElement: class {},
    customElements: { get() {}, define(_name, constructor) { Search = constructor; } },
    window: { theme: { formatMoney: cents => `$${(cents / 100).toFixed(2)}`, escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;") } },
  });
  vm.runInContext(read("assets/predictive-search.js"), scope);
  const search = new Search();
  search.dataset = { fromPrice: "From __PRICE__", viewAll: "View all" };
  search.results = document.querySelector("#results");
  search.render([{ ...product(), price: "80.00", price_min: "80.00", price_max: "280.00", compare_at_price_min: "200.00" }], "art");
  const p = search.results.querySelector("a > p:last-child");
  assert.ok(p.querySelector("s"));
  assert.equal(p.textContent.trim(), "$200.00 From $80.00");
});

test("starting price uses the existing translation and preserves currency formatting", async () => {
  const liquid = engine();
  liquid.registerFilter("money", () => "€80,00");
  liquid.registerFilter("t", (key, ...args) => key === "products.product.from_price_html" ? `Ab ${Object.fromEntries(args).price}` : key);
  const html = await liquid.renderFile("product-card", { ...context(), product: { ...product(), price_varies: true } });
  assert.equal(parseHTML(html).document.querySelector(".space-y-1 > p:last-child").textContent.trim(), "Ab €80,00");
});

for (const [name, variants, expected] of [
  ["available Oak", [{ options: ["Rolled Canvas"], available: true }, { options: ["Oak Float Frame"], available: true }], "oak"],
  ["sold out Oak fallback", [{ options: ["Oak Float Frame"], available: false }, { options: ["Black Float Frame"], available: true }], "black"],
  ["legacy Oak", [{ options: ["No frame"], available: true }, { options: ["wood"], available: true }], "oak"],
  ["all sold out", [{ options: ["Walnut frame"], available: false }], "walnut"],
]) {
  test(`wishlist preview uses ${name} without changing the starting price`, async () => {
    const painting = { ...product(), options: [{ name: "FRAME" }], variants, price: 8000 };
    const dom = browserDom(await renderPage("main-wishlist"), {
      saved: [painting.handle], fetch: async () => ({ ok: true, json: async () => painting }),
    });
    for (const script of ["utils.js", "wishlist.js", "wishlist-page.js"]) dom.run(script);
    await settle();
    assert.equal(dom.document.querySelector('[data-frame-box]').dataset.frame, expected);
    assert.equal(dom.document.querySelector('[data-wishlist-card] .space-y-1 > p:last-child').textContent, "$80.00");
  });
}
