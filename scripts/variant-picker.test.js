import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { read } from "./test-support/theme-fixtures.js";

const frames = ["Oak frame", "Black frame", "Walnut frame", "No frame"];
const sizes = ["40 × 20 cm", "150 × 75 cm"];
const escape = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function fixture({ optionNames = ["Size", "Frame"], initialFrame = "Oak frame", unavailable = false, missing = false } = {}) {
  const variants = sizes.flatMap((size, i) => frames.map((frame, j) => ({
    id: 100 + i * 4 + j,
    options: optionNames.map(name => name.toLowerCase() === "size" ? size : frame),
    available: !(unavailable && frame === "Black frame"),
    price: i ? 28000 : 8000,
  }))).filter(v => !(missing && v.options.includes("Black frame") && v.options.includes(sizes[0])));
  const current = variants.find(v => v.options.includes(initialFrame));
  const button = (name, value) => `<button type="button" data-option-button data-option-name="${name}" data-option-value="${escape(value)}" aria-pressed="${current.options.includes(value)}">${escape(value)}</button>`;
  const markup = `<div class="shopify-section"><variant-picker data-add-text="Add to cart" data-sold-out-text="Sold out" data-unavailable-text="Unavailable">
    <form><input data-variant-id-input><button type="submit" data-atc><span data-atc-text></span><span data-atc-price></span></button></form>
    <script data-variants type="application/json">${JSON.stringify(variants)}</script>
    <script data-option-names type="application/json">${JSON.stringify(optionNames)}</script>
    <script data-current-variant type="application/json">${JSON.stringify(current)}</script>
    <div data-desktop>${frames.map(frame => button("Frame", frame)).join("")}${sizes.map(size => button("Size", size)).join("")}<span data-frame-name>Oak frame</span></div>
    <div data-mobile>${frames.map(frame => button("Frame", frame)).join("")}<span data-row-frame-name>Oak frame</span></div>
    <span data-main-price></span><span data-framed-note>, framed</span>
  </variant-picker></div><div data-unrelated><span data-frame-name>Other product</span></div>`;
  const { window, document } = parseHTML(markup);
  const events = [];
  const location = { href: "https://shop.test/products/painting" };
  const scope = vm.createContext({
    HTMLElement: window.HTMLElement, customElements: window.customElements,
    document, URL, CustomEvent: window.CustomEvent,
    window: {
      location,
      history: { replaceState: (_state, _title, url) => { location.href = String(url); } },
      theme: { formatMoney: price => `$${(price / 100).toFixed(2)}`, sectionRoot: el => el.closest(".shopify-section") },
      dispatchEvent: event => events.push(event),
    },
  });
  vm.runInContext(read("assets/variant-picker.js"), scope);
  const picker = document.querySelector("variant-picker");
  const click = (frame, mode = "desktop") => {
    const button = [...picker.querySelectorAll(`[data-${mode}] [data-option-name="Frame"]`)].find(el => el.dataset.optionValue === frame);
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  };
  const assertLabels = frame => {
    assert.equal(picker.querySelector("[data-frame-name]").textContent, frame);
    assert.equal(picker.querySelector("[data-row-frame-name]").textContent, frame);
    assert.equal(document.querySelector("[data-unrelated] [data-frame-name]").textContent, "Other product");
  };
  return { picker, events, location, click, assertLabels };
}

test("desktop and mobile frame labels follow every swatch, form variant, URL and preview event", () => {
  const { picker, events, location, click, assertLabels } = fixture();
  for (const frame of [...frames, "Oak frame"]) {
    click(frame);
    assertLabels(frame);
    assert.equal(events.at(-1).detail.frame, frame);
    assert.equal(events.at(-1).detail.source, picker);
    assert.ok(events.at(-1).detail.variant.options.includes(frame));
    assert.equal(String(events.at(-1).detail.variant.id), picker.idInput.value);
    assert.equal(new URL(location.href).searchParams.get("variant"), picker.idInput.value);
    assert.equal(picker.querySelectorAll('[data-option-name="Frame"][aria-pressed="true"]').length, 2);
    assert.equal(picker.querySelector("[data-framed-note]").classList.contains("hidden"), frame === "No frame");
  }
});

test("mobile swatches and later size changes keep both labels in sync", () => {
  const { picker, click, assertLabels } = fixture();
  click("Walnut frame", "mobile");
  assertLabels("Walnut frame");
  picker.select(picker.canonicalName("Size"), sizes[1]);
  assertLabels("Walnut frame");
  assert.equal(picker.querySelector("[data-main-price]").textContent, "$280.00");
  assert.equal(picker.idInput.value, "106");
});

test("initial variant hydration and differently cased, reordered options use the same frame value", () => {
  const { click, assertLabels } = fixture({ optionNames: ["frame", "SIZE"], initialFrame: "Walnut frame" });
  assertLabels("Walnut frame");
  click("Black frame");
  assertLabels("Black frame");
});

test("sold-out selections update names while keeping add to cart disabled", () => {
  const { picker, click, assertLabels } = fixture({ unavailable: true });
  click("Black frame");
  assertLabels("Black frame");
  assert.equal(picker.atc.disabled, true);
  assert.equal(picker.atc.querySelector("[data-atc-text]").textContent, "Sold out");
});

test("nonexistent combinations still show the selected frame without submitting a stale variant", () => {
  const { picker, click, assertLabels } = fixture({ missing: true });
  click("Black frame");
  assertLabels("Black frame");
  assert.equal(picker.idInput.value, "");
  assert.equal(picker.atc.disabled, true);
  assert.equal(picker.atc.querySelector("[data-atc-text]").textContent, "Unavailable");
  click("Oak frame");
  assertLabels("Oak frame");
  assert.equal(picker.atc.disabled, false);
});

function rolledFixture({ available = true, otherFinish = false, optionNames } = {}) {
  const context = fixture({ optionNames });
  const { picker } = context;
  const options = (size, frame) => picker.optionNames.map(name => name.toLowerCase() === 'size' ? size : frame);
  picker.variants.push({id: 900, options: options('240 × 120 cm', 'Rolled Canvas'), available, price: 40500});
  picker.variants.push({id: 901, options: options(sizes[0], 'Rolled Canvas'), available: true, price: 6000});
  if (otherFinish) picker.variants.push({id:902, options:options('240 × 120 cm','Oak frame'), available:false, price:50000});
  picker.dataset.rolledOnlyNotice = 'Rolled canvas only for this size.';
  for (const mode of ['desktop', 'mobile']) picker.querySelector(`[data-${mode}]`).insertAdjacentHTML('beforeend', '<button data-option-name="Size" data-option-value="240 × 120 cm"><span data-rolled-only-label></span></button><span data-size-price="240 × 120 cm"></span><button data-option-name="Frame" data-option-value="Rolled Canvas"></button>');
  picker.insertAdjacentHTML('beforeend', '<p data-rolled-only-notice></p>');
  picker.update();
  return context;
}

test('rolled-only sizes stay available and switch size, frame, price, URL and preview together', () => {
  const {picker, location, events, assertLabels} = rolledFixture();
  assert.equal(picker.querySelector('[data-option-value="240 × 120 cm"]').hasAttribute('data-soldout'),false);
  assert.equal(picker.querySelector('[data-size-price="240 × 120 cm"]').textContent,'$405.00');
  picker.select('Size','240 × 120 cm');
  assertLabels('Rolled Canvas');
  assert.equal(picker.idInput.value,'900');
  assert.equal(picker.atc.disabled,false);
  assert.equal(new URL(location.href).searchParams.get('variant'),'900');
  assert.equal(events.at(-1).detail.frame,'Rolled Canvas');
  assert.equal(picker.querySelector('[data-rolled-only-notice]').classList.contains('hidden'),false);
  assert.equal(picker.querySelector('[data-option-value="Oak frame"]').disabled,true);
  picker.select('Size',sizes[0]);
  assert.equal(picker.querySelector('[data-rolled-only-notice]').classList.contains('hidden'),true);
  assert.equal(picker.querySelector('[data-option-value="Oak frame"]').disabled,false);
});

test('unavailable rolled stock or sold-out framed variants never trigger a delivery substitution', () => {
  for (const options of [{available:false},{otherFinish:true}]) {
    const {picker,assertLabels}=rolledFixture(options);
    picker.select('Size','240 × 120 cm');
    assertLabels('Oak frame');
    assert.equal(picker.atc.disabled,true);
  }
});

test('rolled-only selection supports reordered and differently cased option names', () => {
  const {picker,assertLabels}=rolledFixture({optionNames:['frame','SIZE']});
  picker.select('Size','240 × 120 cm');
  assertLabels('Rolled Canvas');
  assert.equal(picker.idInput.value,'900');
});

test("real product markup retains desktop frame cards and the mobile frame label hook", () => {
  const source = read("sections/main-product.liquid");
  assert.match(source, /Canvas delivery & framing/);
  assert.match(source, /data-option-value="{{ value \| escape }}"/);
  assert.match(source, /data-row-frame-name[^>]*>{{ frame_val }}/);
});

test('separate rolled choice follows exact size, availability, selection and price', () => {
  const {picker} = rolledFixture();
  picker.insertAdjacentHTML('beforeend', '<button data-rolled-choice data-option-button data-option-name="Frame" data-option-value="Rolled Canvas"><span data-rolled-title></span><span data-rolled-price></span><span data-rolled-selected></span></button>');
  const card=picker.querySelector('[data-rolled-choice]');
  picker.update();
  assert.equal(card.querySelector('[data-rolled-price]').textContent,'$60.00');
  assert.equal(card.disabled,false);
  picker.select('Frame','Rolled Canvas');
  assert.equal(card.getAttribute('aria-pressed'),'true');
  assert.equal(picker.idInput.value,'901');
  picker.select('Size','240 × 120 cm');
  assert.equal(card.querySelector('[data-rolled-price]').textContent,'$405.00');
  picker.variants.find(v=>v.id===900).available=false;
  picker.update();
  assert.equal(card.disabled,true);
  assert.equal(picker.atc.disabled,true);
  picker.select('Size',sizes[1]);
  assert.equal(card.querySelector('[data-rolled-price]').textContent,'Unavailable');
  assert.equal(card.disabled,true);
  picker.select('Frame','Oak frame');
  assert.equal(card.getAttribute('aria-pressed'),'false');
  assert.equal(picker.atc.disabled,false);
});

test('sale banner follows the selected variant discount and hides at full price',()=>{
 const {picker,click}=fixture();const banner=picker.ownerDocument.createElement('div');banner.setAttribute('data-sale-banner','');banner.innerHTML='<span data-sale-banner-percent></span>';picker.parentElement.appendChild(banner);
 const v=picker.variants[0];v.compare_at_price=10000;v.price=6000;picker.update();assert.equal(banner.hidden,false);assert.equal(banner.textContent,'40');
 click('Black frame');assert.equal(banner.hidden,true);
 click('Oak frame');assert.equal(banner.hidden,false);assert.equal(banner.textContent,'40');
});
