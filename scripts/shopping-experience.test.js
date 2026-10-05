import assert from "node:assert/strict";
import test from "node:test";
import { context, engine, line, product, renderPage, renderSection } from "./test-support/theme-fixtures.js";
import { browserDom, settle } from "./test-support/browser-dom.js";

async function cartBrowser(items = [line()], options = {}) {
  let current = items;
  const calls = [];
  const fixture = await renderPage("main-cart", context(current));
  const dom = browserDom(fixture, { fetch: async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url, payload });
    if (options.fetch) return options.fetch(url, payload);
    current = current.map((item) => item.key === payload.id ? { ...item, quantity: payload.quantity, final_line_price: payload.quantity * 8000 } : item)
      .filter((item) => item.quantity > 0);
    const ctx = context(current);
    return { ok: true, json: async () => ({ ...ctx.cart, sections: { [payload.sections[0]]: await renderSection("main-cart", ctx) } }) };
  } });
  dom.run("cart.js");
  return { dom, calls };
}

test("cart uses the rendered section and stable item key; all displays follow the same response", async () => {
  const { dom, calls } = await cartBrowser();
  dom.run("cart.js"); // A section re-executing its script must not double-submit.
  dom.click('[data-cart-change="increase"]');
  assert.equal(dom.document.querySelector('[name="checkout"]').disabled, true);
  assert.equal(dom.submit(), true);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.id, "901:original");
  assert.deepEqual(calls[0].payload.sections, ["template--22435099082806__main-cart"]);
  assert.equal(calls[0].payload.sections_url, "/cart");
  assert.equal(dom.document.querySelector("[data-cart-count]").textContent, "2");
  assert.match(dom.document.querySelector("[data-cart-section]").textContent, /\$160\.00 USD/);
  assert.equal(dom.document.querySelector('[name="checkout"]').disabled, false);
  assert.equal(dom.document.activeElement.dataset.cartChange, "increase");
  assert.match(dom.document.querySelector("[data-cart-status]").textContent, /Item count: 2.*\$160\.00 USD/);
  dom.click('[data-cart-change="decrease"]');
  await settle();
  assert.match(dom.document.querySelector("[data-cart-section]").textContent, /\$80\.00 USD/);
  assert.equal(dom.reloads, 0);
});

test("deleting a row preserves the next row's key and keyboard focus; the final deletion focuses the empty heading", async () => {
  const { dom, calls } = await cartBrowser([line("901:one"), line("901:two", 1, product("second-painting", 102))]);
  dom.click('[data-cart-change="remove"]');
  await settle();
  assert.equal(dom.document.activeElement.closest("[data-cart-item]").dataset.cartKey, "901:two");
  dom.click('[data-cart-change="increase"]');
  await settle();
  assert.equal(calls[1].payload.id, "901:two");
  dom.click('[data-cart-change="remove"]');
  await settle();
  assert.equal(dom.document.querySelector("[name='checkout']"), null);
  assert.equal(dom.document.querySelector("[data-cart-count]").hasAttribute("hidden"), true);
  assert.equal(dom.document.activeElement.hasAttribute("data-cart-heading"), true);
});

test("cart ignores repeated clicks while pending and reloads only once without resubmitting on network failure", async () => {
  let reject;
  const { dom, calls } = await cartBrowser([line()], { fetch: () => new Promise((_, fail) => { reject = fail; }) });
  dom.click('[data-cart-change="increase"]');
  dom.click('[data-cart-change="increase"]');
  assert.equal(calls.length, 1);
  reject(new Error("Offline"));
  await settle();
  dom.click('[data-cart-change="increase"]');
  assert.equal(calls.length, 1);
  assert.equal(dom.reloads, 1);
  assert.equal(dom.document.querySelector('[name="checkout"]').disabled, true);
});

for (const [name, response] of [
  ["HTTP 422", { ok: false, status: 422 }],
  ["missing section", { ok: true, json: async () => ({ item_count: 2, sections: {} }) }],
  ["null section", { ok: true, json: async () => ({ item_count: 2, sections: { "template--22435099082806__main-cart": null } }) }],
  ["wrong target", { ok: true, json: async () => ({ item_count: 2, sections: { "template--22435099082806__main-cart": '<div data-cart-section="other"></div>' } }) }],
  ["invalid JSON", { ok: true, json: async () => { throw new SyntaxError("JSON"); } }],
]) {
  test(`cart recovers from ${name} without unlocking stale checkout`, async () => {
    const { dom, calls } = await cartBrowser([line()], { fetch: async () => response });
    dom.click('[data-cart-change="increase"]');
    await settle();
    assert.equal(dom.reloads, 1);
    assert.equal(calls.length, 1);
    assert.equal(dom.document.querySelector('[name="checkout"]').disabled, true);
  });
}

test("a cart target removed while its request is pending forces recovery", async () => {
  let resolve;
  const html = await renderSection("main-cart", context([line(undefined, 2)]));
  const { dom } = await cartBrowser([line()], { fetch: () => new Promise((done) => { resolve = done; }) });
  dom.click('[data-cart-change="increase"]');
  dom.document.querySelector("[data-cart-section]").remove();
  resolve({ ok: true, json: async () => ({ item_count: 2, sections: { "template--22435099082806__main-cart": html } }) });
  await settle();
  assert.equal(dom.reloads, 1);
});

test("cart requests keep locale-aware routes", async () => {
  const { dom, calls } = await cartBrowser();
  dom.window.theme.routes.cartChange = "/fr/cart/change";
  dom.window.location.href = "https://example.com/fr/cart";
  dom.click('[data-cart-change="increase"]');
  await settle();
  assert.equal(calls[0].url, "/fr/cart/change.js");
  assert.equal(calls[0].payload.sections_url, "/fr/cart");
});

async function wishlistBrowser(saved, fetch) {
  const dom = browserDom(await renderPage("main-wishlist"), { saved, fetch });
  dom.run("utils.js");
  dom.run("wishlist.js");
  dom.run("wishlist-page.js");
  await settle();
  return dom;
}

const okProduct = (handle) => ({ ok: true, json: async () => product(handle) });

test("saving from a real product card opens in the wishlist and removal persists back to the card", async () => {
  const cardHtml = await engine().renderFile("product-card", { ...context(), product: product() });
  const html = `<html><body><span data-wishlist-count></span>${cardHtml}</body></html>`;
  const card = browserDom(html);
  card.run("wishlist.js");
  card.click("[data-wishlist-toggle]");
  assert.equal(card.document.querySelector("[data-wishlist-toggle]").getAttribute("aria-pressed"), "true");
  assert.equal(card.document.querySelector("[data-wishlist-count]").textContent, "1");
  const saved = JSON.parse(card.storage.get("makeready-wishlist"));
  const page = await wishlistBrowser(saved, async () => okProduct(product().handle));
  assert.ok(page.document.querySelector(`[data-wishlist-card="${product().handle}"] a`));
  page.click("[data-wishlist-grid] [data-wishlist-toggle]");
  await settle();
  const reload = browserDom(html, { saved: JSON.parse(page.storage.get("makeready-wishlist")) });
  reload.run("wishlist.js");
  assert.equal(reload.document.querySelector("[data-wishlist-toggle]").getAttribute("aria-pressed"), "false");
  assert.equal(reload.document.querySelector("[data-wishlist-count]").hasAttribute("hidden"), true);
});

test("wishlist migrates known legacy IDs, preserves unknown IDs and unavailable handles, and deduplicates", async () => {
  const handle = product().handle;
  const dom = await wishlistBrowser(["101", handle, "999", "removed-painting"], async (url) => url.includes(handle)
    ? okProduct(handle) : { ok: false, status: 404 });
  assert.deepEqual(JSON.parse(dom.storage.get("makeready-wishlist")), [handle, "999", "removed-painting"]);
  assert.equal(dom.document.querySelectorAll("[data-wishlist-card]").length, 3);
  assert.equal(dom.document.querySelector("[data-wishlist-page-count]").textContent, "3");
  assert.match(dom.document.querySelector('[data-wishlist-card="999"]').textContent, /no longer available/);
  dom.click('[data-wishlist-card="removed-painting"] button');
  await settle();
  assert.deepEqual(JSON.parse(dom.storage.get("makeready-wishlist")), [handle, "999"]);
  assert.equal(dom.document.querySelector("[data-wishlist-count]").textContent, "2");
});

test("wishlist network failure remains visible and retries without losing saved items", async () => {
  let healthy = false;
  const dom = await wishlistBrowser(["retry-painting"], async () => {
    if (!healthy) throw new Error("Offline");
    return okProduct("retry-painting");
  });
  assert.equal(dom.document.querySelector("[data-wishlist-error]").hidden, false);
  assert.equal(dom.document.querySelector("[data-wishlist-retry]").hidden, false);
  assert.equal(dom.document.querySelector("[data-wishlist-empty]").classList.contains("hidden"), true);
  assert.deepEqual(JSON.parse(dom.storage.get("makeready-wishlist")), ["retry-painting"]);
  healthy = true;
  dom.click("[data-wishlist-retry]");
  await settle();
  assert.equal(dom.document.querySelector("[data-wishlist-error]").hidden, true);
  assert.ok(dom.document.querySelector('[data-wishlist-card="retry-painting"] a'));
});

test("wishlist changes during loading do not resurrect a removed item", async () => {
  let resolve;
  const dom = await wishlistBrowser(["slow-painting"], () => new Promise((done) => { resolve = done; }));
  assert.equal(dom.document.querySelector("[data-wishlist-loading]").hidden, false);
  dom.window.wishlist.remove("slow-painting");
  await settle();
  resolve(okProduct("slow-painting"));
  await settle();
  assert.equal(dom.document.querySelectorAll("[data-wishlist-card]").length, 0);
  assert.equal(dom.document.querySelector("[data-wishlist-empty]").classList.contains("hidden"), false);
});

test("a malformed product response does not break other saved products and can be retried", async () => {
  let healthy = false;
  const dom = await wishlistBrowser(["broken", "healthy"], async (url) => {
    const handle = url.includes("broken") ? "broken" : "healthy";
    return { ok: true, json: async () => ({ ...product(handle), title: handle === "broken" && !healthy ? null : "Painting" }) };
  });
  assert.ok(dom.document.querySelector('[data-wishlist-card="healthy"] a'));
  assert.equal(dom.document.querySelector("[data-wishlist-error]").hidden, false);
  assert.equal(dom.document.querySelector("[data-wishlist-page]").getAttribute("aria-busy"), "false");
  assert.deepEqual(JSON.parse(dom.storage.get("makeready-wishlist")), ["broken", "healthy"]);
  healthy = true;
  dom.click("[data-wishlist-retry]");
  await settle();
  assert.ok(dom.document.querySelector('[data-wishlist-card="broken"] a'));
  assert.equal(dom.document.querySelector("[data-wishlist-error]").hidden, true);
});

test("wishlist removal updates its page and counters and survives a reload", async () => {
  const dom = await wishlistBrowser(["first", "second"], async (url) => okProduct(url.split("/").pop().replace(".js", "")));
  dom.click('[data-wishlist-card="first"] button');
  await settle();
  assert.equal(dom.document.querySelectorAll("[data-wishlist-card]").length, 1);
  dom.click('[data-wishlist-card="second"] button');
  await settle();
  assert.equal(dom.document.activeElement.hasAttribute("data-wishlist-heading"), true);
  const reload = await wishlistBrowser(JSON.parse(dom.storage.get("makeready-wishlist")), async () => { throw new Error("Should not fetch"); });
  assert.equal(reload.document.querySelector("[data-wishlist-empty]").classList.contains("hidden"), false);
});

test("announcement rotation hides inactive links, pauses for keyboard focus and cleans up removed bars", async () => {
  const html = await renderPage("main-cart", context(), { messages: true });
  const dom = browserDom(html);
  const callbacks = [];
  let cleared = 0;
  dom.scope.setInterval = (callback) => { callbacks.push(callback); return 1; };
  dom.scope.clearInterval = () => { cleared++; };
  dom.run("announcement-bar.js");
  dom.run("announcement-bar.js");
  assert.equal(callbacks.length, 1);
  const messages = [...dom.document.querySelectorAll("[data-announcement-message]")];
  messages[0].querySelector("a").focus();
  callbacks[0]();
  assert.equal(messages[0].hasAttribute("aria-hidden"), false);
  dom.document.body.focus();
  callbacks[0]();
  assert.equal(messages[0].getAttribute("aria-hidden"), "true");
  assert.equal(messages[0].inert, true);
  assert.equal(messages[1].hasAttribute("aria-hidden"), false);
  assert.equal(messages[1].inert, false);
  dom.document.querySelector("[data-announcement]").remove();
  callbacks[0]();
  assert.equal(cleared, 1);
});

test("wishlist placeholders do not expose internal product identifiers", async () => {
  const dom = await wishlistBrowser(["999"], async () => { throw new Error("Should not fetch"); });
  assert.doesNotMatch(dom.document.querySelector("[data-wishlist-grid]").textContent, /999/);
  assert.equal(dom.document.querySelector('[data-wishlist-toggle="999"]').getAttribute("aria-label"), "Remove from wishlist");
});
