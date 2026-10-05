import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, "assets", file), "utf8");

function fixture(savedCurrency = null, country = "SG") {
  const { window, document } = parseHTML(`<html lang="en"><body>
    <span data-display-money data-cents="10000">$100.00</span>
    <display-currency-selector><select data-display-currency-select>
      <option value="USD">USD</option><option value="SGD">SGD</option><option value="EUR">EUR</option><option value="ILS">ILS</option>
    </select></display-currency-selector>
  </body></html>`);
  const storage = new Map();
  if (savedCurrency) storage.set("canvasra-display-currency", savedCurrency);
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  window.theme = {
    moneyFormat: "${{amount}}",
    displayCurrencyConfig: { enabled: true, country, locale: "en", rates: { SGD: 1.28, EUR: 0.92, ILS: 3.7 } },
  };
  const scope = vm.createContext({
    window, document, HTMLElement: window.HTMLElement, customElements: window.customElements,
    CustomEvent: window.CustomEvent, Intl, localStorage,
    fetch: async () => { throw new Error("offline"); },
    URL,
  });
  vm.runInContext(read("utils.js"), scope);
  vm.runInContext(read("display-currency.js"), scope);
  return { window, document, storage };
}

test("visitor country selects a display currency while preserving canonical cents", async () => {
  const { window, document } = fixture();
  await Promise.resolve();
  assert.equal(window.theme.displayCurrency.currency, "SGD");
  assert.match(document.querySelector("[data-display-money]").textContent, /128\.00\u00A0SGD/);
  assert.equal(document.querySelector("[data-display-money]").dataset.cents, "10000");
  assert.match(window.theme.formatMoney(2500), /data-cents="2500"/);
});

test("Israel visitors see estimated prices in ILS", async () => {
  const { window, document } = fixture(null, "IL");
  await Promise.resolve();
  assert.equal(window.theme.displayCurrency.currency, "ILS");
  assert.match(document.querySelector("[data-display-money]").textContent, /370\.00\u00A0ILS/);
});

test("manual currency selection persists and reconverts existing prices", () => {
  const { window, document, storage } = fixture("USD");
  assert.equal(window.theme.displayCurrency.currency, "USD");
  window.theme.displayCurrency.setCurrency("EUR");
  assert.equal(storage.get("canvasra-display-currency"), "EUR");
  assert.match(document.querySelector("[data-display-money]").textContent, /92\.00\u00A0EUR/);
});

test("price labels never break between the amount and the currency code", async () => {
  const { window, document } = fixture();
  await Promise.resolve();
  for (const code of ["SGD", "EUR", "ILS"]) {
    window.theme.displayCurrency.setCurrency(code);
    const label = document.querySelector("[data-display-money]").textContent;
    // a plain space here is what pushed "CNY"/"SGD" onto its own line in narrow cards
    assert.doesNotMatch(label, / /, `plain space in "${label}"`);
    assert.equal((label.match(new RegExp(code, "g")) || []).length, 1, `code repeated in "${label}"`);
    assert.match(label, new RegExp(`\\u00A0${code}$`), `code not attached in "${label}"`);
  }
});
