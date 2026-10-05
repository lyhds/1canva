import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { context, engine, product, read } from "./test-support/theme-fixtures.js";

const sizes = ["40 × 20 cm", "100 × 50 cm", "150 × 75 cm"];
const frames = ["Oak frame", "Black frame", "Walnut frame", "No frame"];

async function fixture({ unit = "cm", sizeValues = sizes, soldOut = [], options = ["Size", "Frame"], pages = { contact: { url: "/pages/contact" } }, master = true, rolledOnly = false } = {}) {
  const painting = product();
  if (!master) painting.media[0].alt = "Room view";
  painting.options = options;
  painting.options_with_values = options.map(name => ({ name, values: name === "Size" ? sizeValues : name === "Frame" ? frames : ["Standard", "Other"] }));
  painting.variants = sizeValues.flatMap((size, i) => frames.map((frame, j) => ({
    id: 100 + i * 4 + j,
    options: options.map(name => name === "Size" ? size : name === "Frame" ? frame : "Standard"),
    available: !soldOut.includes(`${size}|${frame}`), price: [8000, 20000, 28000][i] + j * 1000,
  })));
  if (rolledOnly) {
    painting.variants = painting.variants.filter(v => v.options[options.indexOf("Size")] !== sizes[2]);
    painting.variants.push({ id: 999, options: options.map(name => name === "Size" ? sizes[2] : name === "Frame" ? "Rolled Canvas" : "Standard"), available: !soldOut.includes(`${sizes[2]}|Rolled Canvas`), price: 21000 });
  }
  painting.selected_or_first_available_variant = painting.variants[0];
  const ctx = { ...context(), pages, product: painting };
  const liquid = engine(ctx);
  liquid.registerFilter("placeholder_svg_tag", () => "<svg></svg>");
  const html = await liquid.renderFile("sections/main-product.liquid", { ...ctx, section: { id: "size-guide-test", settings: {}, blocks: [] } });
  const { window, document } = parseHTML(`<html><body><div class="shopify-section">${html}</div><div id="other-section" class="shopify-section"><variant-picker id="other-picker"></variant-picker></div></body></html>`);
  document.querySelector("#other-picker").remove();
  Object.defineProperty(document, "activeElement", { value: document.body, writable: true, configurable: true });
  window.HTMLElement.prototype.focus = function () { document.activeElement = this; };
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", { get() { return this.closest(".hidden") ? null : this.parentElement; }, configurable: true });
  const location = { href: "https://shop.test/products/painting" };
  const fakeWindow = {
    location, theme: { moneyFormat: "${{amount}}" }, dataLayer: [],
    history: { replaceState: (_state, _title, url) => { location.href = String(url); } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
  };
  const scope = vm.createContext({ window: fakeWindow, document, HTMLElement: window.HTMLElement, customElements: window.customElements, CustomEvent: window.CustomEvent, URL });
  for (const file of ["utils.js", "modal.js", "variant-picker.js", "size-guide-visualizer.js"]) vm.runInContext(read(`assets/${file}`), scope);
  const modal = document.querySelector("size-guide-modal");
  Object.defineProperty(modal.stage, "clientWidth", { value: 500, configurable: true });
  Object.defineProperty(modal.stage, "clientHeight", { value: 350, configurable: true });
  const click = element => {
    const target = typeof element === "string" ? modal.querySelector(element) : element;
    assert.ok(target);
    target.focus();
    target.dispatchEvent(new window.Event("click", { bubbles: true }));
  };
  if (unit) click(`[data-sg-unit="${unit}"]`);
  return { modal, picker: document.querySelector("variant-picker"), document, window: fakeWindow, Event: window.CustomEvent, location, click };
}

test("real Liquid size-guide payload carries localized prices, translation tokens and a working contact fallback", async () => {
  const { modal } = await fixture();
  modal.open();
  assert.equal(modal.priceEl.textContent, "$80.00 USD");
  assert.equal(modal.captionEl.textContent, "19% of Sofa width");
  assert.equal(modal.widthHint.textContent, "Enter 60–600 cm.");
  assert.equal(modal.suggestBtn.textContent, "Preview 150 × 75 cm");
  assert.equal(modal.querySelector("a").getAttribute("href"), "/pages/contact");
  assert.equal(modal.querySelectorAll("[data-modal-close]").length, 1);
  assert.equal(modal.applyBtn.type, "button");
  assert.ok(modal.widthInput.getAttribute("aria-describedby"));
});

test("dual-unit catalog sizes render at real scale and apply the original variant label", async () => {
  const sizeValues = ["40 x 60 cm / 15.7 x 23.6 in", "50 x 75 cm / 19.7 x 29.5 in", "60 x 90 cm / 23.6 x 35.4 in"];
  const { modal, picker, click } = await fixture({ sizeValues });
  modal.open();
  assert.equal(JSON.stringify(modal.data.sizes.map(({ w, h }) => [w, h])), JSON.stringify([[40, 60], [50, 75], [60, 90]]));
  assert.equal(modal.artEl.hidden, false);
  assert.equal(modal.applyBtn.disabled, false);
  click('[data-sg-size="' + sizeValues[1] + '"]');
  const width = modal.artEl.style.width;
  click('[data-sg-unit="in"]');
  assert.equal(modal.selectedEl.textContent, "19.7 × 29.5 in");
  assert.equal(modal.artEl.style.width, width);
  click('[data-sg-apply]');
  assert.equal(String(picker.idInput.value), "104");
});

test("size parsing accepts decimal metric dimensions and rejects non-metric or malformed sizes", async () => {
  const { modal } = await fixture({ sizeValues: ["40.5X60.5 CM / 15.9 x 23.8 in", "40 x 60 in", "40oops x 60 cm"] });
  assert.equal(modal.data.sizes.length, 1);
  assert.equal(modal.data.sizes[0].w, 40.5);
  assert.equal(modal.data.sizes[0].h, 60.5);
});

test("cm/in toggles change display only, without cumulative rounding or variant changes", async () => {
  const { modal, picker, click } = await fixture();
  modal.open();
  const width = modal.artEl.style.width;
  const id = picker.idInput.value;
  for (let i = 0; i < 10; i++) {
    click('[data-sg-unit="in"]');
    assert.equal(modal.selectedEl.textContent, "15.7 × 7.9 in");
    assert.equal(modal.widthInput.value, "84");
    click('[data-sg-unit="cm"]');
  }
  assert.equal(modal.state.widthCm, 213.36);
  assert.equal(modal.artEl.style.width, width);
  assert.equal(picker.idInput.value, id);
  assert.equal(modal.sizesEl.firstElementChild.dataset.sgSize, sizes[0]);
});

test("width input handles imperial conversion, invalid values, bounds and per-scene memory", async () => {
  const { modal, click } = await fixture();
  modal.open();
  click('[data-sg-unit="in"]');
  modal.setWidth("100");
  assert.equal(modal.state.widthCm, 254);
  for (const value of ["", "not a number", Infinity]) modal.setWidth(value);
  assert.equal(modal.state.widthCm, 254);
  click('[data-sg-scene="bed"]');
  assert.equal(modal.state.widthCm, 152.4);
  click('[data-sg-scene="sofa"]');
  assert.equal(modal.state.widthCm, 254);
  click('[data-sg-unit="cm"]');
  modal.setWidth(-10);
  assert.equal(modal.state.widthCm, 60);
  assert.equal(modal.querySelector('[data-sg-step="-1"]').disabled, true);
  modal.setWidth(10000);
  assert.equal(modal.state.widthCm, 600);
  assert.equal(modal.querySelector('[data-sg-step="1"]').disabled, true);
});

test("guide prices use the currency hook and each render starts with canonical amounts", async () => {
  const { modal, window, click } = await fixture();
  let conversions = 0;
  window.theme.reconvertPrices = () => {
    conversions++;
    const prices = [...modal.querySelectorAll("span.money")];
    assert.equal(prices.length, sizes.length + 1);
    for (const price of prices) {
      assert.match(price.textContent, /^\$[\d.]+ USD$/);
      price.textContent = `HK$${(Number(price.textContent.match(/[\d.]+/)[0]) * 7.8).toFixed(2)} HKD`;
    }
  };
  modal.open();
  assert.equal(modal.priceEl.textContent, "HK$624.00 HKD");
  click('[data-sg-size="150 × 75 cm"]');
  assert.equal(modal.priceEl.textContent, "HK$2184.00 HKD");
  click('[data-sg-unit="in"]');
  assert.equal(modal.priceEl.textContent, "HK$2184.00 HKD");
  assert.equal(conversions, 3);
});

test("guide cards and furniture width show both units while toggles preserve the physical scene", async () => {
  const { modal, picker, click } = await fixture();
  modal.open();
  const width = modal.artEl.style.width;
  const variantId = picker.idInput.value;
  const primary = () => modal.sizesEl.firstElementChild.firstElementChild.textContent;
  const secondary = () => modal.sizesEl.firstElementChild.querySelector("[data-sg-size-secondary]").textContent;
  assert.equal(primary(), "40 × 20 cm");
  assert.equal(secondary(), "15.7 × 7.9 in");
  assert.equal(modal.widthSecondary.textContent, "≈ 84 in");
  assert.ok(modal.widthInput.getAttribute("aria-describedby").includes(modal.widthSecondary.id));
  click('[data-sg-unit="in"]');
  assert.equal(primary(), "15.7 × 7.9 in");
  assert.equal(secondary(), "40 × 20 cm");
  assert.equal(modal.widthSecondary.textContent, "≈ 213.4 cm");
  assert.equal(modal.artEl.style.width, width);
  assert.equal(picker.idInput.value, variantId);
  modal.setWidth("100");
  assert.equal(modal.widthSecondary.textContent, "≈ 254 cm");
  click('[data-sg-scene="bed"]');
  assert.equal(modal.widthSecondary.textContent, "≈ 152.4 cm");
  click('[data-sg-unit="cm"]');
  assert.equal(modal.widthSecondary.textContent, "≈ 60 in");
  assert.equal(primary(), "40 × 20 cm");
  assert.equal(secondary(), "15.7 × 7.9 in");
});

test("suggestions use only available sizes in the 60–75% band and never apply furniture advice to walls", async () => {
  const { modal, picker, click } = await fixture();
  modal.open();
  assert.equal(modal.suggestedSize().value, sizes[2]);
  click("[data-sg-suggest]");
  assert.equal(modal.state.sizeValue, sizes[2]);
  assert.equal(picker.state.Size, sizes[0]);
  modal.setWidth(600);
  assert.equal(modal.suggestedSize(), null);
  assert.equal(modal.suggestBtn.hidden, true);
  click('[data-sg-scene="wall"]');
  assert.equal(modal.suggestedSize(), null);
  assert.equal(modal.widthLabel.textContent, "Wall width · cm");
  assert.match(modal.adviceEl.textContent, /both dimensions use the same scale/);
  const soldOut = await fixture({ soldOut: [`${sizes[2]}|Oak frame`] });
  soldOut.modal.open();
  assert.equal(soldOut.modal.suggestedSize(), null);
});

test("live frame changes update texture, option-specific prices and exact variant application", async () => {
  const { modal, picker, click, location, window } = await fixture();
  picker.select("Frame", "Black frame");
  modal.open();
  assert.equal(modal.artEl.dataset.frame, "black");
  assert.match(modal.artEl.style.borderImageSource, /frame-black/);
  assert.equal(modal.priceEl.textContent, "$90.00 USD");
  click(modal.sizesEl.lastElementChild);
  assert.equal(modal.priceEl.textContent, "$290.00 USD");
  assert.equal(picker.state.Size, sizes[0]);
  click('[data-sg-unit="in"]');
  click("[data-sg-apply]");
  assert.equal(picker.state.Size, sizes[2]);
  assert.equal(picker.frameValue, "Black frame");
  assert.equal(picker.idInput.value, "109");
  assert.equal(new URL(location.href).searchParams.get("variant"), "109");
  assert.ok(modal.classList.contains("hidden"));
  assert.equal(window.dataLayer.findLast(e => e.event === "size_guide_apply_size").variantId, 109);
  picker.select("Frame", "No frame");
  modal.open();
  assert.equal(modal.artEl.style.borderWidth, "0px");
  assert.equal(modal.artEl.style.borderImageSource, "none");
});

test("size guide uses slim rails for every material without changing artwork scale", async () => {
  const { modal, picker, click } = await fixture();
  modal.open();
  for (const size of sizes) {
    click(`[data-sg-size="${size}"]`);
    const width = parseFloat(modal.artEl.style.width);
    const height = parseFloat(modal.artEl.style.height);
    for (const frame of frames) {
      picker.select("Frame", frame);
      click(`[data-sg-size="${size}"]`);
      assert.equal(parseFloat(modal.artEl.style.width), width);
      assert.equal(parseFloat(modal.artEl.style.height), height);
      const rail = parseFloat(modal.artEl.style.borderWidth);
      assert.equal(rail, frame === "No frame" ? 0 : Math.max(1.5, width * 0.0165));
      assert.ok(Math.abs(parseFloat(modal.artEl.style.left) + (width + 2 * rail) / 2 - 500) < 0.001);
      if (frame !== "No frame") assert.ok(rail < Math.max(4, width * 0.035));
    }
  }
});

test("closing without applying discards the draft, retains unit preference and restores trigger focus", async () => {
  const { modal, picker, document, click } = await fixture();
  const trigger = document.querySelector("[data-modal-open]");
  click(trigger);
  assert.equal(document.activeElement, modal.querySelector("[data-modal-close]"));
  click(modal.sizesEl.lastElementChild);
  click('[data-sg-unit="in"]');
  click("[data-modal-close]");
  assert.equal(picker.state.Size, sizes[0]);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.documentElement.style.overflow, "");
  click(trigger);
  assert.equal(modal.state.sizeValue, sizes[0]);
  assert.equal(modal.state.unit, "in");
});

test("sold-out sizes cannot be applied, including when a stale draft is selected", async () => {
  const { modal, picker, click } = await fixture({ soldOut: [`${sizes[2]}|Oak frame`] });
  modal.open();
  assert.equal(modal.sizesEl.lastElementChild.disabled, true);
  click(modal.sizesEl.lastElementChild);
  assert.equal(modal.state.sizeValue, sizes[0]);
  modal.state.sizeValue = sizes[2];
  modal.render();
  assert.equal(modal.applyBtn.disabled, true);
  modal.applySize();
  assert.equal(picker.state.Size, sizes[0]);
  assert.ok(!modal.classList.contains("hidden"));
});

test("other sections cannot change the guide and matching includes reordered and additional options", async () => {
  const { modal, picker, window, document, Event } = await fixture({ options: ["Frame", "Edition", "Size"] });
  modal.open();
  assert.equal(modal.priceEl.textContent, "$80.00 USD");
  window.dispatchEvent(new Event("variant:change", { detail: { source: document.querySelector("#other-section"), variant: modal.data.variants[3] } }));
  assert.equal(modal.state.frameValue, "Oak frame");
  picker.state.Edition = "Other";
  modal.open();
  assert.equal(modal.variantForSize(sizes[0]), undefined);
  assert.equal(modal.suggestedSize(), null);
  assert.equal(modal.applyBtn.disabled, true);
});

test("invalid dimension payloads fail closed and custom links never point at nonexistent pages", async () => {
  const { modal } = await fixture({ pages: {} });
  modal.data.sizes = [];
  modal.open();
  assert.equal(modal.applyBtn.disabled, true);
  assert.equal(modal.artEl.hidden, true);
  assert.ok(!modal.emptyEl.classList.contains("hidden"));
  assert.equal(modal.querySelector("a"), null);
  const custom = await fixture({ pages: { "custom-painting": { url: "/pages/custom-painting" }, contact: { url: "/pages/contact" } } });
  assert.equal(custom.modal.querySelector("a").getAttribute("href"), "/pages/custom-painting");
});

test("manual outline mode handles incorrectly tagged room photos without changing dimensions or prices", async () => {
  const { modal, click } = await fixture();
  modal.open();
  const width = modal.artEl.style.width;
  click("[data-sg-outline]");
  assert.equal(modal.artImg.hidden, true);
  assert.equal(modal.outlineBtn.getAttribute("aria-pressed"), "true");
  assert.match(modal.captionEl.textContent, /Size outline only/);
  assert.equal(modal.artEl.style.width, width);
  assert.equal(modal.priceEl.textContent, "$80.00 USD");
  click("[data-sg-outline]");
  assert.equal(modal.artImg.hidden, false);
});

test("products without a dedicated master image show a labelled outline, not a falsely scaled room photo", async () => {
  const { modal } = await fixture({ master: false });
  modal.open();
  assert.equal(modal.data.scaleImageAvailable, false);
  assert.equal(modal.artImg.hidden, true);
  assert.equal(modal.artImg.getAttribute("src"), null);
  assert.match(modal.captionEl.textContent, /Size outline only/);
  assert.equal(modal.applyBtn.disabled, false);
  assert.equal(modal.priceEl.textContent, "$80.00 USD");
});

test("very tall wall artwork stays inside the stage when the entire scene zooms out", async () => {
  const { modal } = await fixture();
  modal.open();
  modal.state.scene = "wall";
  modal.state.widthCm = 60;
  modal.renderScene({ w: 200, h: 600 });
  assert.ok(modal.camBottom > 700);
  const scale = 0.5 * modal.camZoom;
  const artTop = Number.parseFloat(modal.artEl.style.top);
  const outerHeight = Number.parseFloat(modal.artEl.style.height) + 2 * Number.parseFloat(modal.artEl.style.borderWidth);
  assert.ok(350 + (artTop - modal.camBottom) * scale >= 0);
  assert.ok(350 + (artTop + outerHeight - modal.camBottom) * scale <= 350.001);
});

test("repeated opening and component reconnection preserve focus and clean up variant subscriptions", async () => {
  const { modal, picker, document, click } = await fixture();
  const trigger = document.querySelector("[data-modal-open]");
  click(trigger);
  modal.open();
  modal.close();
  assert.equal(document.activeElement, trigger);
  modal.open();
  modal.remove();
  assert.equal(document.documentElement.style.overflow, "");
  picker.select("Frame", "Black frame");
  assert.equal(modal.state.frameValue, "Oak frame");
  document.querySelector(".shopify-section").append(modal);
  modal.open();
  assert.equal(modal.state.frameValue, "Black frame");
  picker.select("Frame", "Walnut frame");
  assert.equal(modal.state.frameValue, "Walnut frame");
});

test("rendering preserves keyboard focus on size options and camera zooms the complete scene", async () => {
  const { modal, document, click } = await fixture();
  modal.open();
  click(modal.sizesEl.lastElementChild);
  assert.equal(document.activeElement.dataset.sgSize, sizes[2]);
  modal.setWidth(60);
  assert.ok(modal.camZoom < 1);
  assert.equal(Number.parseFloat(modal.artEl.style.width) / Number.parseFloat(modal.artEl.style.height), 2);
  assert.match(modal.world.style.transform, /scale\([\d.]+\)/);
  assert.match(modal.captionEl.textContent, /Wider than this space/);
  modal.setWidth(149.9);
  assert.match(modal.captionEl.textContent, /100%.*Wider than this space/);
});

test("rolled-only guide previews delivery without applying until confirmed", async () => {
  const { modal, picker, click } = await fixture({ rolledOnly: true, options: ["Frame", "Edition", "Size"] });
  modal.open();
  assert.equal(modal.sizesEl.lastElementChild.disabled, false);
  click(modal.sizesEl.lastElementChild);
  assert.equal(modal.frameEl.textContent, "Rolled Canvas");
  assert.equal(modal.priceEl.textContent, "$210.00 USD");
  assert.equal(modal.artEl.style.borderWidth, "0px");
  assert.equal(modal.querySelector('[data-sg-rolled-only]').hidden, false);
  assert.equal(picker.frameValue, "Oak frame");
  modal.close();
  modal.open();
  assert.equal(modal.state.sizeValue, sizes[0]);
  click(modal.sizesEl.lastElementChild);
  click('[data-sg-apply]');
  assert.equal(picker.idInput.value, "999");
  assert.equal(picker.frameValue, "Rolled Canvas");
  assert.equal(picker.atc.disabled, false);
});

test("guide never substitutes unavailable rolled stock or a different edition", async () => {
  const { modal, picker } = await fixture({ rolledOnly: true, soldOut: [`${sizes[2]}|Rolled Canvas`] });
  modal.open();
  assert.equal(modal.sizesEl.lastElementChild.disabled, true);
  modal.state.sizeValue = sizes[2];
  modal.render();
  modal.applySize();
  assert.equal(picker.frameValue, "Oak frame");
  const other = await fixture({ rolledOnly: true, options: ["Frame", "Edition", "Size"] });
  other.picker.state.Edition = "Other";
  other.modal.open();
  assert.equal(other.modal.sizesEl.lastElementChild.disabled, true);
});


test("wall has visible bounds with independently editable height and width at one physical scale", async () => {
  const { modal, click } = await fixture();
  modal.open();
  click('[data-sg-scene="wall"]');
  assert.equal(modal.wallEl.hidden, false);
  assert.equal(modal.wallEl.classList.contains("hidden"), false);
  assert.equal(modal.heightGroup.hidden, false);
  modal.setWidth(300);
  modal.setHeight(240);
  const wallW = parseFloat(modal.wallEl.style.width);
  assert.ok(Math.abs(parseFloat(modal.wallEl.style.height) / wallW - 240 / 300) < 1e-9);
  assert.ok(Math.abs(parseFloat(modal.artEl.style.width) / wallW - 40 / 300) < 1e-9);
  const artWidth = modal.artEl.style.width;
  modal.setHeight(300);
  assert.equal(modal.artEl.style.width, artWidth);
  assert.ok(Math.abs(parseFloat(modal.wallEl.style.height) / wallW - 1) < 1e-9);
  click('[data-sg-unit="in"]');
  modal.setHeight(96);
  assert.equal(modal.state.wallHeightCm, 243.84);
  for (const value of ["", "no", Infinity]) modal.setHeight(value);
  assert.equal(modal.state.wallHeightCm, 243.84);
  click('[data-sg-scene="sofa"]');
  assert.equal(modal.heightGroup.hidden, true);
  assert.equal(modal.wallEl.hidden, true);
  click('[data-sg-scene="wall"]');
  assert.equal(modal.state.wallHeightCm, 243.84);
  click('[data-sg-unit="cm"]');
  modal.setHeight(60);
  click('[data-sg-size="150 × 75 cm"]');
  assert.match(modal.captionEl.textContent, /Taller than this wall/);
});

test("US furniture references calibrate to visible furniture rather than SVG padding", async () => {
  const { modal, click } = await fixture();
  modal.open();
  for (const [scene, cm, visibleWidth] of [["sofa", 213.36, 640], ["bed", 152.4, 592], ["console", 121.92, 440]]) {
    click(`[data-sg-scene="${scene}"]`);
    assert.equal(modal.state.widthCm, cm);
    assert.ok(Math.abs(parseFloat(modal.artEl.style.width) / visibleWidth - 40 / cm) < 1e-9);
    assert.equal(modal.furnitureEl.hidden, false);
    assert.equal(modal.furnitureEl.style.height, "auto");
    assert.ok(modal.referenceEl.textContent.length > 20);
  }
});

test("size guide defaults to inches in cards, summary and furniture controls", async () => {
  const { modal } = await fixture({ unit: null });
  modal.open();
  assert.equal(modal.state.unit, "in");
  assert.equal(modal.sizesEl.firstElementChild.firstElementChild.textContent, "15.7 × 7.9 in");
  assert.equal(modal.selectedEl.textContent, "15.7 × 7.9 in");
  assert.equal(modal.secondaryEl.textContent, "40 × 20 cm");
  assert.equal(Number(modal.widthInput.value), 84);
  assert.equal(modal.querySelector('[data-sg-unit="in"]').getAttribute("aria-pressed"), "true");
});
