import assert from "node:assert/strict";
import test from "node:test";
import { context, line, renderSection } from "./test-support/theme-fixtures.js";
import { browserDom, settle } from "./test-support/browser-dom.js";

const DRAWER_ID = "template--22435099082806__cart-drawer";
const CART_ID = "template--22435099082806__main-cart";

function sectionIdOf(html) {
  return html.match(/data-cart-section="([^"]+)"/)[1];
}

test("cart drawer renders the empty state and, with items, the shared cart contracts", async () => {
  const empty = await renderSection("cart-drawer", context([]));
  assert.match(empty, /Your cart is empty/);
  assert.doesNotMatch(empty, /data-cart-change/);
  assert.match(empty, /collections\/all/);

  const html = await renderSection("cart-drawer", context([line()]));
  assert.match(html, /data-cart-item/);
  assert.match(html, /data-cart-change="increase"/);
  assert.match(html, /data-cart-change="remove"/);
  assert.match(html, /name="checkout"/);
  assert.match(html, /data-cart-drawer-open|View cart/);
  assert.match(html, /\$80\.00 USD/);
});

test("one quantity change refreshes both the drawer and the cart page sections in a single request", async () => {
  const calls = [];
  const [drawerHtml, cartHtml] = [
    await renderSection("cart-drawer", context([line()])),
    await renderSection("main-cart", context([line()])),
  ];
  const dom = browserDom(drawerHtml + cartHtml, { fetch: async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url, payload });
    const ctx = context([{ ...line(), quantity: 2, final_line_price: 16000 }]);
    const [d, c] = await Promise.all([renderSection("cart-drawer", ctx), renderSection("main-cart", ctx)]);
    return { ok: true, json: async () => ({ ...ctx.cart, sections: { [sectionIdOf(d)]: d, [sectionIdOf(c)]: c } }) };
  } });
  dom.run("cart.js");
  dom.click(`[data-cart-section="${DRAWER_ID}"] [data-cart-change="increase"]`);
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0].payload.sections].sort(), [DRAWER_ID, CART_ID].sort());
  assert.match(dom.document.querySelector(`[data-cart-section="${DRAWER_ID}"]`).textContent, /\$160\.00/);
  assert.match(dom.document.querySelector(`[data-cart-section="${CART_ID}"]`).textContent, /\$160\.00/);
  assert.equal(dom.document.querySelector("[data-cart-count]").textContent, "2");
  assert.equal(dom.reloads, 0);
});

test("adding to cart posts AJAX with sections, swaps them and opens the drawer", async () => {
  const calls = [];
  const dom = browserDom(await renderSection("cart-drawer", context([line()])), { fetch: async (url, init) => {
    calls.push({ url, payload: init.body ? JSON.parse(init.body) : null });
    const ctx = context([{ ...line(), quantity: 2, final_line_price: 16000 }]);
    if (url === "/cart.js") return { ok: true, json: async () => ctx.cart };
    const d = await renderSection("cart-drawer", ctx);
    return { ok: true, json: async () => ({ id: 901, quantity: 2, sections: { [sectionIdOf(d)]: d } }) };
  } });
  dom.window.location.href = "https://example.com/products/art?variant=901#details";
  dom.window.theme.routes.cartAdd = "/cart/add";
  dom.run("cart.js");
  dom.run("cart-drawer.js");
  const form = dom.document.createElement("form");
  form.setAttribute("action", "/cart/add");
  form.innerHTML = '<input name="id" value="901:original"><input name="quantity" value="1"><button data-atc type="submit">Add to cart</button>';
  dom.document.body.append(form);
  const drawer = dom.document.querySelector("cart-drawer");
  let opened = false;
  drawer.open = () => { opened = true; };
  const event = new dom.document.defaultView.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/cart.js");
  assert.equal(calls[0].payload.sections_url, "/products/art?variant=901");
  assert.equal(calls[0].url, "/cart/add.js");
  assert.equal(calls[0].payload.id, "901:original");
  assert.equal(calls[0].payload.quantity, 1);
  assert.deepEqual(calls[0].payload.sections, [DRAWER_ID]);
  assert.equal(opened, true);
  assert.equal(dom.reloads, 0);
  assert.equal(form.querySelector("[data-atc]").hasAttribute("disabled"), false);
  assert.match(dom.document.querySelector(`[data-cart-section="${DRAWER_ID}"]`).textContent, /\$160\.00/);
});

test("a rejected add stays on the product and shows Shopify's error without re-posting", async () => {
  const dom = browserDom(await renderSection("cart-drawer", context([line()])), { fetch: async () => ({ ok: false, status: 422, json: async () => ({ description: "This option is sold out." }) }) });
  dom.window.theme.routes.cartAdd = "/cart/add";
  dom.run("cart.js");
  dom.run("cart-drawer.js");
  const form = dom.document.createElement("form");
  form.setAttribute("action", "/cart/add");
  form.innerHTML = '<input name="id" value="901:original"><button data-atc type="submit">Add to cart</button>';
  dom.document.body.append(form);
  let nativeSubmits = 0;
  form.submit = () => { nativeSubmits++; };
  const drawer = dom.document.querySelector("cart-drawer");
  drawer.open = () => { throw new Error("drawer must not open"); };
  form.dispatchEvent(new dom.document.defaultView.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(nativeSubmits, 0);
  assert.equal(form.querySelector('[role="alert"]').textContent, "This option is sold out.");
  assert.equal(dom.reloads, 0);
});

test("missing add sections show an error without navigation or re-adding the item", async () => {
  const dom = browserDom(await renderSection("cart-drawer", context([line()])), { fetch: async () => ({ ok: true, json: async () => ({ item_count: 2, sections: {} }) }) });
  dom.window.theme.routes.cartAdd = "/cart/add";
  dom.run("cart.js");
  dom.run("cart-drawer.js");
  const form = dom.document.createElement("form");
  form.setAttribute("action", "/cart/add");
  form.innerHTML = '<input name="id" value="901:original"><button data-atc type="submit">Add to cart</button>';
  dom.document.body.append(form);
  let nativeSubmits = 0;
  form.submit = () => { nativeSubmits++; };
  form.dispatchEvent(new dom.document.defaultView.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(dom.reloads, 0);
  assert.match(form.querySelector('[role="alert"]').textContent, /check your cart/);
  assert.equal(nativeSubmits, 0);
});

test("the header cart button opens the drawer instead of navigating", async () => {
  const dom = browserDom(await renderSection("cart-drawer", context([line()])));
  dom.run("cart-drawer.js");
  const link = dom.document.createElement("a");
  link.setAttribute("data-cart-drawer-open", "");
  link.href = "/cart";
  dom.document.body.append(link);
  const drawer = dom.document.querySelector("cart-drawer");
  let opened = false;
  drawer.open = () => { opened = true; };
  dom.click(link);
  assert.equal(opened, true);
});

test("removing the last drawer item from a product URL renders the empty drawer without navigation", async () => {
  const calls = [];
  const dom = browserDom(await renderSection("cart-drawer", context([line()])), { fetch: async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url, payload });
    assert.equal(payload.sections_url, "/products/art?variant=901");
    const empty = await renderSection("cart-drawer", context([]));
    return { ok: true, json: async () => ({ item_count: 0, sections: { [sectionIdOf(empty)]: empty } }) };
  } });
  dom.window.location.href = "https://example.com/products/art?variant=901#details";
  dom.run("cart.js");
  const drawer = dom.document.querySelector("cart-drawer");
  drawer.classList.add("is-open");
  dom.click('[data-cart-change="remove"] svg');
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/cart/change.js");
  assert.equal(calls[0].payload.id, "901:original");
  assert.equal(calls[0].payload.quantity, 0);
  assert.equal(drawer.querySelector("[data-cart-item]"), null);
  assert.match(drawer.textContent, /Your cart is empty/);
  assert.equal(drawer.classList.contains("is-open"), true);
  assert.equal(dom.reloads, 0);
});
