import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { engine, context, product, read } from "./test-support/theme-fixtures.js";

test("size labels convert centimeters to inches and preserve unknown values safely", async () => {
  const liquid = engine();
  for (const [value, expected] of [
    ["50 × 70 cm", "19.7 × 27.6 in / 50 × 70 cm"],
    ["61 × 61 cm", "24 × 24 in / 61 × 61 cm"],
    ["150 × 75 cm", "59.1 × 29.5 in / 150 × 75 cm"],
    ["60.96 x 60.96 CM", "24 × 24 in / 60.96 x 60.96 CM"],
    // Current catalog format: reorder to inches first, keep the stored segments verbatim.
    ["61 x 81 cm / 24 x 32 in", "24 x 32 in / 61 x 81 cm"],
    ["61 × 81 cm / 24 × 32 in", "24 × 32 in / 61 × 81 cm"],
    ["Custom size", "Custom size"], ["24 × 24 in", "24 × 24 in"],
    ["0 × 50 cm", "0 × 50 cm"], ["5..0 × 50 cm", "5..0 × 50 cm"],
    ["61 x 81 cm / twenty in", "61 x 81 cm / twenty in"],
    ['Custom "size" <tag>', 'Custom &#34;size&#34; &lt;tag&gt;'],
  ]) assert.equal((await liquid.renderFile("size-label", { value })).trim(), expected);
});

test("real PDP size labels survive selection while submitted variants retain centimeter values", async () => {
  const painting = product();
  const sizes = ["40 × 20 cm", "150 × 75 cm"];
  painting.variants = sizes.map((size, i) => ({ id: 901 + i, options: [size, "Oak frame"], price: 8000 + i * 20000, available: true }));
  painting.options_with_values = [{ name: "Size", values: sizes }, { name: "Frame", values: ["Oak frame"] }];
  painting.selected_or_first_available_variant = painting.variants[0];
  const ctx = { ...context(), product: painting };
  const liquid = engine(ctx);
  liquid.registerFilter("placeholder_svg_tag", () => "<svg></svg>");
  const html = await liquid.renderFile("sections/main-product.liquid", { ...ctx, section: { id: "size-test", settings: {}, blocks: [] } });
  const { document, window } = parseHTML(`<div class="shopify-section">${html}</div>`);
  const picker = document.querySelector("variant-picker");
  assert.equal(picker.querySelectorAll("[data-size-label]").length, 4);
  const labels = ["15.7 × 7.9 in / 40 × 20 cm", "59.1 × 29.5 in / 150 × 75 cm"];
  for (const button of picker.querySelectorAll("[data-size-label]")) {
    const i = sizes.indexOf(button.dataset.optionValue);
    assert.equal(button.dataset.sizeLabel, labels[i]);
    assert.ok(button.textContent.includes(labels[i]));
  }
  for (const el of document.querySelectorAll("[data-row-size-dims], [data-size-line]")) assert.equal(el.textContent, labels[0]);
  const events = [];
  const location = { href: "https://fixture.invalid/products/painting" };
  vm.runInNewContext(read("assets/variant-picker.js"), {
    HTMLElement: window.HTMLElement, customElements: window.customElements, document, URL, CustomEvent: window.CustomEvent,
    window: { location, history: { replaceState() {} }, dispatchEvent: e => events.push(e), theme: { sectionRoot: el => el.closest(".shopify-section"), formatMoney: cents => String(cents / 100) } },
  });
  const buttons = [...picker.querySelectorAll('[data-option-name="Size"]')];
  // Exercise both the mobile sheet and desktop dropdown, including a return.
  for (const index of [3, 0]) {
    buttons[index].click();
    const i = index === 3 ? 1 : 0;
    for (const el of document.querySelectorAll("[data-row-size-dims], [data-size-line]")) assert.equal(el.textContent, labels[i]);
    assert.equal(picker.idInput.value, String(901 + i));
    assert.equal(events.at(-1).detail.variant.options[0], sizes[i]);
  }
});
