import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { context, engine, parseJson, product, read } from "./test-support/theme-fixtures.js";

const main = parseJson("templates/product.json").sections.main;
const ids = main.block_order.filter(id => main.blocks[id].type === "feature");

async function render(blocks = main.block_order.map(id => ({ id, ...main.blocks[id] }))) {
  const painting = product();
  painting.selected_or_first_available_variant = painting.variants[0];
  const ctx = { ...context(), product: painting };
  const liquid = engine(ctx);
  liquid.registerFilter("placeholder_svg_tag", () => "<svg></svg>");
  return parseHTML(await liquid.renderFile("sections/main-product.liquid", {
    ...ctx, section: { id: "trust-test", settings: main.settings, blocks },
  })).document;
}

test("four existing feature blocks render concise trust titles and decorative icons", async () => {
  const document = await render();
  const group = document.querySelector("[data-product-trust]");
  const items = [...group.querySelectorAll("[data-trust-item]")];
  assert.deepEqual(ids, ["feature-1", "feature-2", "feature-3", "feature-4"]);
  assert.deepEqual(items.map(el => el.querySelector("h3").textContent), [
    "Preview Before Shipping", "Free Insured Shipping", "14-Day Returns", "Safe Payment Options",
  ]);
  assert.ok(group.classList.contains("grid-cols-2"));
  assert.ok(group.classList.contains("lg:grid-cols-4"));
  assert.equal(group.querySelectorAll("p").length, 0);
  for (const item of items) {
    assert.ok(item.querySelector("h3").classList.contains("font-medium"));
    assert.equal(item.querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.ok(item.querySelector("svg path"));
  }
  assert.equal(document.querySelectorAll("details.border-b").length, 3);
});

test("trust claims disclose the review deadline while keeping destinations unnamed and 14-day returns", () => {
  const settings = ids.map(id => main.blocks[id].settings);
  assert.match(settings[0].text, /photos of your finished painting/);
  assert.match(settings[0].text, /revise until you are satisfied/);
  assert.match(settings[0].text, /If all 3 emails go unanswered, we ship after 3 days from the first photo email/);
  assert.doesNotMatch(JSON.stringify(settings[0]), /only after your approval|Ship After You Are Satisfied/i);
  assert.match(settings[1].text, /Insured and tracked delivery to your door/);
  assert.match(settings[1].text, /Duties and taxes for normal delivery included/);
  assert.doesNotMatch(JSON.stringify(settings), /U\.S\.|United States|Canada|Australia/);
  assert.match(settings[2].text, /within 14 days of delivery/);
  assert.match(settings[2].text, /You cover change-of-mind return shipping/);
  assert.match(settings[3].text, /Shopify/);
  assert.match(settings[3].text, /payment methods are shown at checkout/);
  assert.doesNotMatch(JSON.stringify(settings), /30[- ]day|worldwide|100%|money.back.guarantee|free returns|videos/i);
});

test("trust icon choices and optional heading are supported by the merchant block schema", () => {
  const schema = JSON.parse(read("sections/main-product.liquid").match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const fields = schema.blocks.find(block => block.type === "feature").settings;
  const icons = fields.find(field => field.id === "icon").options.map(option => option.value);
  assert.equal(fields.find(field => field.id === "heading").type, "text");
  for (const id of ids) assert.ok(icons.includes(main.blocks[id].settings.icon));
  for (const icon of ["layers", "frame", "shield-check", "rotate-ccw"]) assert.ok(icons.includes(icon));
});

test("legacy text-only feature blocks fall back to a concise escaped title", async () => {
  const document = await render([
    { type: "feature", settings: { icon: "frame", text: "Legacy framing message" } },
    { type: "feature", settings: { icon: "check", heading: "<img src=x>", text: "A & B" } },
  ]);
  const items = document.querySelectorAll("[data-trust-item]");
  assert.equal(items[0].querySelector("h3").textContent, "Legacy framing message");
  assert.equal(items[1].querySelector("h3").textContent, "<img src=x>");
  assert.equal(items[1].querySelector("img"), null);
  assert.equal(document.querySelectorAll("[data-trust-item] p").length, 0);
});
