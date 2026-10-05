import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { context, product, read, renderSection } from "./test-support/theme-fixtures.js";

function collection(handle, products = [], root = "") {
  return { handle, title: handle, url: `${root}/collections/${handle}`, products, products_count: products.length, filters: [], sort_options: [{ value: "manual", name: "Featured" }], default_sort_by: "manual" };
}

async function page(handle = "all-products", tags = [], root = "") {
  const paintings = ["one", "two", "three", "four"].map((name, index) => ({ ...product(name, index), tags: index ? [] : ["col-abstract"] }));
  const collections = {
    "all-products": collection("all-products", paintings, root),
    abstract: collection("abstract", paintings, root),
    landscapes: collection("landscapes", [], root),
  };
  return parseHTML(await renderSection("main-collection", { ...context(), collections, collection: collections[handle], current_tags: tags })).document;
}

test("desktop and mobile subjects point to the same canonical collections, including empty ones", async () => {
  const document = await page();
  for (const form of document.querySelectorAll("[data-filter-form]")) {
    assert.deepEqual([...form.querySelectorAll("[data-subject-filter]")].map(el => el.value), ["/collections/all-products", "/collections/abstract", "/collections/landscapes"]);
  }
  assert.equal(document.querySelector('[value="/collections/animals"]'), null);
});

test("subject collection membership is authoritative even when old tags are missing", async () => {
  const document = await page("abstract");
  assert.match(document.querySelector('[data-filters-rerender="count"]').textContent, /4 items/);
  assert.equal(document.querySelectorAll('[data-filters-rerender="results"] [data-wishlist-toggle]').length, 4);
  for (const form of document.querySelectorAll("[data-filter-form]")) {
    assert.equal(form.querySelector("[data-subject-filter][checked]").value, "/collections/abstract");
  }
  assert.ok(document.querySelector("[data-subject-clear]"));
  assert.equal(document.querySelector('[data-filters-rerender="chips"] a:last-child').getAttribute("href"), "/collections/all-products?sort_by=manual");
});

test("legacy subject URLs resolve through real, locale-aware collection objects", async () => {
  const document = await page("all-products", ["col-abstract"], "/fr");
  assert.equal(document.querySelector("collection-filters").dataset.subjectRedirectUrl, "/fr/collections/abstract");
  const unknown = await page("all-products", ["col-unknown"]);
  assert.equal(unknown.querySelector("collection-filters").dataset.subjectRedirectUrl, "");
});

function controller(href = "https://shop.test/collections/all-products", dataset = {}) {
  let Filter;
  const navigations = [];
  const replacements = [];
  const url = new URL(href);
  const scope = vm.createContext({
    HTMLElement: class {},
    customElements: { get() {}, define(name, value) { Filter = value; } },
    URL, URLSearchParams, AbortController,
    window: { location: { href, pathname: url.pathname, search: url.search, assign: value => navigations.push(value), replace: value => replacements.push(value) }, addEventListener() {} },
    document: { addEventListener() {} },
  });
  vm.runInContext(read("assets/collection-filters.js"), scope);
  const instance = new Filter();
  instance.dataset = { collectionUrl: url.pathname, ...dataset };
  instance.addEventListener = () => {};
  instance.querySelector = () => null;
  instance.connectedCallback();
  return { instance, navigations, replacements };
}

function form(subjectUrl) {
  return {
    elements: [
      { name: "subject", value: subjectUrl, type: "radio", checked: true },
      { name: "filter.v.price.gte", value: "80", type: "number" },
      { name: "filter.v.availability", value: "1", type: "checkbox", checked: true },
      { name: "filter.p.m.custom.orientation", value: "Landscape", type: "checkbox", checked: true },
      { name: "filter.p.m.custom.orientation", value: "Portrait", type: "checkbox", checked: false },
      { name: "disabled-filter", value: "bad", type: "checkbox", checked: true, disabled: true },
    ],
    querySelector: () => ({ value: subjectUrl }),
  };
}

test("subject changes navigate to canonical collection preserving native filters and sorting", () => {
  const { instance, navigations } = controller("https://shop.test/fr/collections/all-products?page=3");
  instance.querySelector = selector => selector === "[data-sort-select]" ? { value: "price-descending" } : null;
  instance.submit(form("/fr/collections/abstract"));
  const target = new URL(navigations[0]);
  assert.equal(target.pathname, "/fr/collections/abstract");
  assert.equal(target.searchParams.get("filter.v.price.gte"), "80");
  assert.equal(target.searchParams.get("filter.v.availability"), "1");
  assert.deepEqual(target.searchParams.getAll("filter.p.m.custom.orientation"), ["Landscape"]);
  assert.equal(target.searchParams.get("sort_by"), "price-descending");
  for (const key of ["subject", "page", "disabled-filter"]) assert.equal(target.searchParams.has(key), false);
});

test("clearing only the subject keeps native filters and returns to all paintings", () => {
  const { instance, navigations } = controller("https://shop.test/collections/abstract");
  instance.submit(form("/collections/abstract"), "/collections/all-products");
  const target = new URL(navigations[0]);
  assert.equal(target.pathname, "/collections/all-products");
  assert.equal(target.searchParams.get("filter.v.availability"), "1");
});

test("sorting and facet changes stay in the current collection", () => {
  const { instance } = controller("https://shop.test/collections/abstract");
  let rendered;
  instance.render = url => { rendered = url; };
  instance.submit(form("/collections/abstract"));
  assert.equal(new URL(rendered, "https://shop.test").pathname, "/collections/abstract");
});

test("legacy links replace browser history and retain filters without stale pagination", () => {
  const { replacements } = controller("https://shop.test/fr/collections/all-products/col-abstract?filter.v.price.gte=80&page=3&sort_by=price-ascending", { subjectRedirectUrl: "/fr/collections/abstract" });
  const target = new URL(replacements[0]);
  assert.equal(target.pathname, "/fr/collections/abstract");
  assert.equal(target.searchParams.get("filter.v.price.gte"), "80");
  assert.equal(target.searchParams.get("sort_by"), "price-ascending");
  assert.equal(target.searchParams.has("page"), false);
});

test("AJAX filtering restores saved hearts and selected currency on fresh cards", async () => {
  const { browserDom, settle } = await import('./test-support/browser-dom.js');
  const initial = await page();
  const fresh = await page();
  const dom = browserDom(initial.toString(), { saved: ['one'], fetch: async () => ({ ok: true, text: async () => fresh.toString() }) });
  dom.window.location = { href: 'https://shop.test/collections/all-products', pathname: '/collections/all-products' };
  dom.window.history = { pushState() {} };
  dom.run('utils.js');
  dom.run('wishlist.js');
  dom.window.theme.reconvertPrices = () => {
    dom.document.querySelectorAll('[data-display-money]').forEach(el => { el.textContent = `EUR ${Number(el.dataset.cents) / 100 * 0.9}`; });
  };
  let Filter;
  dom.scope.customElements = { get() {}, define(_name, value) { Filter = value; } };
  dom.scope.HTMLElement = class {};
  dom.run('collection-filters.js');
  const filter = new Filter();
  const root = dom.document.querySelector('collection-filters');
  filter.querySelector = root.querySelector.bind(root);
  filter.sectionId = 'collection';
  const old = root.querySelector('[data-wishlist-toggle]');
  filter.render('https://shop.test/collections/all-products?sort_by=price-ascending', true, false);
  await settle();
  assert.equal(old.isConnected, false);
  assert.equal(root.querySelector('[data-wishlist-toggle="one"]').getAttribute('aria-pressed'), 'true');
  assert.equal(root.querySelector('[data-wishlist-toggle="two"]').getAttribute('aria-pressed'), 'false');
  assert.equal(root.querySelector('[data-display-money]').textContent, 'EUR 72');
});

test("tapping the pager moves the viewport to the new results instead of staying at the footer", async () => {
  let Filter;
  const calls = [];
  const scope = vm.createContext({
    HTMLElement: class {},
    customElements: { get() {}, define(name, value) { Filter = value; } },
    URL, URLSearchParams, AbortController,
    window: { location: { href: "https://shop.test/collections/all-products", pathname: "/collections/all-products" }, addEventListener() {} },
    document: { addEventListener() {} },
  });
  vm.runInContext(read("assets/collection-filters.js"), scope);
  const instance = new Filter();
  instance.dataset = { sectionId: "collection", collectionUrl: "/collections/all-products" };
  instance.querySelector = () => null;
  let click = null;
  instance.addEventListener = (type, handler) => { if (type === "click") click = handler; };
  instance.render = (url, push, scroll) => calls.push({ url, push, scroll });
  instance.connectedCallback();

  const link = { href: "https://shop.test/collections/all-products?page=2" };
  click({ target: { closest: (selector) => (selector === "a[data-ajax-link]" ? link : null) }, preventDefault() {} });
  assert.equal(calls.length, 1, "the pager must be handled by the AJAX path");
  assert.equal(calls[0].url, link.href);
  assert.equal(calls[0].push, true, "the page URL is pushed into history");
  assert.notEqual(calls[0].scroll, false, "the pager must not leave the scroll position untouched");
  assert.ok(calls[0].scroll, `expected a scroll behaviour for pagination, got ${String(calls[0].scroll)}`);

  // the results block has to clear the fixed 60px mobile header after that jump
  const document = await page();
  assert.match(document.querySelector('[data-filters-rerender="results"]').className, /scroll-mt-/);
});

test('price fields render numeric USD amounts without thousands parsing and preserve empty limits',async()=>{
 for(const selected of [false,true]){
  const c=collection('abstract');c.filters=[{type:'price_range',label:'Price',range_max:247440,min_value:{param_name:'filter.v.price.gte',value:selected?12550:null},max_value:{param_name:'filter.v.price.lte',value:selected?150075:null},active_values:[]}];
  const doc=parseHTML(await renderSection('main-collection',{...context(),active_subject_handle:'',collection:c,collections:{'all-products':c},current_tags:[]})).document;
  for(const form of doc.querySelectorAll('[data-filter-form]')){
   const min=form.querySelector('[name="filter.v.price.gte"]'),max=form.querySelector('[name="filter.v.price.lte"]');
   assert.equal(Number(max.getAttribute('placeholder')),2474.4);assert.equal(min.getAttribute('placeholder'),'0');assert.equal(max.getAttribute('step'),'0.01');
   assert.equal(min.value,selected?'125.5':'');assert.equal(max.value,selected?'1500.75':'');
  }
 }
});

test('orientation switches exclusively, can be cleared, and preserves other filters',()=>{
 const {instance}=controller();const f=form('/collections/all-products');const options=f.elements.filter(e=>e.name==='filter.p.m.custom.orientation');
 f.querySelectorAll=()=>options;options.forEach(e=>e.closest=()=>({}));
 options[1].checked=true;instance.selectOrientation(options[1],f);
 assert.equal(options[0].checked,false);assert.equal(options[1].checked,true);assert.equal(f.elements[2].checked,true);
 let target;instance.render=url=>target=new URL(url,'https://shop.test');instance.submit(f);
 assert.deepEqual(target.searchParams.getAll(options[1].name),['Portrait']);
 options[1].checked=false;instance.selectOrientation(options[1],f);instance.submit(f);assert.equal(target.searchParams.has(options[1].name),false);
});
