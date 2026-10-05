import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { context, engine, parseJson, product, read } from "./test-support/theme-fixtures.js";

const main = parseJson("templates/product.json").sections.main;
const ids = main.block_order.filter(id => main.blocks[id].type === "accordion");
const content = id => main.blocks[id].settings.content;

async function renderProduct() {
  const painting = product();
  painting.selected_or_first_available_variant = painting.variants[0];
  const blocks = main.block_order.map(id => ({ id, ...main.blocks[id] }));
  const ctx = { ...context(), product: painting };
  const liquid = engine(ctx);
  liquid.registerFilter("placeholder_svg_tag", () => "<svg></svg>");
  return liquid.renderFile("sections/main-product.liquid", {
    ...ctx, section: { id: "product-policy-test", settings: main.settings, blocks },
  });
}

test("purchase information stays in three accordions, with policy summaries collapsed below add to cart", async () => {
  const html = await renderProduct();
  const document = parseHTML(html).document;
  const accordions = [...document.querySelectorAll("details.border-b")];
  assert.deepEqual(accordions.map(el => el.querySelector("summary").textContent.trim()), [
    "Painting details", "Shipping & packaging", "Returns & order changes",
  ]);
  assert.ok(accordions[0].hasAttribute("open"));
  const cartButton = document.querySelector('variant-picker button[type="submit"]');
  assert.ok(cartButton);
  const shoppingElements = [...document.querySelectorAll('button[type="submit"], details')];
  for (const row of accordions.slice(1)) {
    assert.equal(row.hasAttribute("open"), false);
    assert.ok(row.querySelector(".rte").textContent.trim());
    assert.ok(shoppingElements.indexOf(row) > shoppingElements.indexOf(cartButton));
  }
  assert.deepEqual(main.block_order.filter(id => main.blocks[id].type === "feature"), [
    "feature-1", "feature-2", "feature-3", "feature-4",
  ]);
});

test("concise shipping summary retains packing, origin, timing and included duties, without naming destinations", () => {
  const shipping = content("accordion-shipping");
  for (const statement of [/securely packed/, /securely packed and shipped\./, /Complimentary insured shipping/, /2–3 weeks/, /production and delivery/, /estimated, not guaranteed/, /duties and taxes.*included/, /Tracking is emailed/, /reviews and revisions may extend it/]) {
    assert.match(shipping, statement);
  }
  assert.doesNotMatch(shipping, /U\.S\.|United States|Canada|Australia/);
  const body = parseHTML(`<div>${shipping}</div>`).document.querySelector("div");
  assert.ok(body.textContent.trim().split(/\s+/).length <= 100);
  assert.ok(body.querySelectorAll("p").length <= 4);
});

test("concise returns summary retains material conditions and combines order changes and damage support", () => {
  const returns = content("accordion-returns");
  for (const statement of [/14 calendar days of delivery/, /Standard made-to-order artwork is eligible/, /unused/, /original protective packaging/, /Personalized, non-standard custom, gift-card and final-sale exclusions apply/, /change-of-mind returns, you pay return shipping/, /approval and instructions before returning/, /Standard orders can be cancelled before shipment/, /including during photo review/, /Custom-colour or non-standard-size cancellations before shipment incur a US\$100 materials fee/, /After dispatch, cancellation is unavailable; the return policy applies/, /damaged, defective or incorrect/, /keep the packaging and send photos/]) {
    assert.match(returns, statement);
  }
  const body = parseHTML(`<div>${returns}</div>`).document.querySelector("div");
  assert.ok(body.textContent.trim().split(/\s+/).length <= 140);
  assert.ok(body.querySelectorAll("p").length <= 4);
});

test("review summary starts the three-day clock at the photo email and discloses no-response shipping", () => {
  const shipping = content("accordion-shipping");
  assert.match(shipping, /photos of your finished painting/);
  assert.match(shipping, /revise until you are satisfied/);
  assert.match(shipping, /If all 3 emails go unanswered, we ship after 3 days from the first photo email/);
  assert.doesNotMatch(ids.map(content).join(" "), /12 hours|only after your approval/i);
});

test("approved policy specification aligns all three policies and preserves standard-option eligibility", () => {
  const draft = read("docs/PURCHASE_POLICY_UPDATE.md");
  const html = [...draft.matchAll(/```html\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]).join("\n");
  assert.match(draft, /Status: approved publication specification/);
  assert.match(draft, /Shipping Policy — targeted updates/);
  assert.match(draft, /Return & Refund Policy — targeted update/);
  assert.match(draft, /Terms of Service — targeted updates/);
  for (const statement of [/3 days \(72 hours\) from the first email/, /3 emails in total/, /initial photo email and 2 reminders/, /A reply stops the no-response dispatch process/, /rather than shipping while those changes are pending/, /same review process then applies to the updated painting/, /US\$100 materials fee/, /fee does not apply to standard artwork purchased in our listed size and frame options/, /14-day deadline and custom-item exclusions/, /applicable consumer law/]) {
    assert.match(html, statement);
  }
  assert.doesNotMatch(html, /12 hours|30[- ]day|only after your approval|3 reminders|money.back.guarantee/i);
});

test("full policies and contact remain linked without separate payment or duplicate policy rows", async () => {
  const document = parseHTML(await renderProduct()).document;
  const links = [...document.querySelectorAll("details .rte a")];
  const destinations = new Set(links.map(link => link.getAttribute("href")));
  for (const destination of ["/policies/shipping-policy", "/policies/refund-policy", "mailto:service@canvasra.com"]) {
    assert.ok(destinations.has(destination), destination);
  }
  for (const link of links) assert.ok(link.textContent.trim());
  assert.deepEqual(ids, ["accordion-shipping", "accordion-returns"]);
  for (const id of ["accordion-packaging", "accordion-payment", "accordion-cancellations", "accordion-damage"]) {
    assert.equal(main.blocks[id], undefined);
  }
  assert.doesNotMatch(ids.map(content).join(" "), /Klarna|Apple Pay|Google Pay|100%|free returns|30[- ]day/i);
});
