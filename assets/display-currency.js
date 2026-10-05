(() => {
  const config = window.theme?.displayCurrencyConfig;
  if (!config?.enabled) return;

  let configuredRates = {};
  try {
    configuredRates = typeof config.rates === "string" ? JSON.parse(config.rates) : config.rates || {};
  } catch { /* invalid merchant JSON falls back to USD */ }
  const supported = new Set(Object.keys(configuredRates));
  supported.add("USD");
  const storageKey = "canvasra-display-currency";
  const ratesKey = "canvasra-display-rates";
  const countryCurrency = {
    AU: "AUD", AT: "EUR", BE: "EUR", BG: "EUR", CA: "CAD", CN: "CNY",
    HR: "EUR", CY: "EUR", CZ: "EUR", DE: "EUR", DK: "EUR", EE: "EUR",
    ES: "EUR", FI: "EUR", FR: "EUR", GR: "EUR", HK: "HKD", HU: "EUR",
    IE: "EUR", IL: "ILS", IT: "EUR", JP: "JPY", LT: "EUR", LU: "EUR", LV: "EUR",
    MT: "EUR", NL: "EUR", NZ: "NZD", PL: "EUR", PT: "EUR", RO: "EUR",
    SE: "EUR", SG: "SGD", SI: "EUR", SK: "EUR", GB: "GBP", US: "USD"
  };

  const readStorage = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const writeStorage = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* storage is optional */ }
  };
  const savedCurrency = readStorage(storageKey);
  const detectedCurrency = countryCurrency[String(config.country || "").toUpperCase()] || "USD";
  let currency = supported.has(savedCurrency) ? savedCurrency : supported.has(detectedCurrency) ? detectedCurrency : "USD";
  let rates = { USD: 1, ...configuredRates };

  const formatter = (code) => new Intl.NumberFormat(config.locale || document.documentElement.lang || "en", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: code === "JPY" ? 0 : 2,
    maximumFractionDigits: code === "JPY" ? 0 : 2,
  });

  const service = {
    get currency() { return currency; },
    format(cents) {
      const amount = Number(cents) / 100;
      if (!Number.isFinite(amount)) return "";
      // Keep the amount, its symbol and the currency code on one line: a plain space lets
      // narrow cards wrap the code alone ("...2,102.40" / "CNY"). Engines without a narrow
      // symbol may already print the code, so never append it twice.
      const label = formatter(currency)
        .formatToParts(amount * (rates[currency] || 1))
        .map((part) => (part.type === "literal" ? part.value.replace(/ /g, "\u00A0") : part.value))
        .join("");
      return label.includes(currency) ? label : `${label}\u00A0${currency}`;
    },
    convertAll(root = document) {
      root.querySelectorAll("[data-display-money][data-cents]").forEach((element) => {
        element.textContent = service.format(Number(element.dataset.cents));
      });
      root.querySelectorAll("[data-display-currency-code]").forEach((element) => {
        element.textContent = currency;
      });
      root.querySelectorAll("[data-display-currency-select]").forEach((select) => {
        select.value = currency;
      });
      document.documentElement.dataset.displayCurrency = currency;
    },
    setCurrency(next) {
      if (!supported.has(next)) return;
      currency = next;
      writeStorage(storageKey, next);
      service.convertAll();
      document.dispatchEvent(new CustomEvent("display-currency:change", { detail: { currency } }));
    },
  };

  window.theme.displayCurrency = service;
  const originalFormatMoney = window.theme.formatMoney;
  window.theme.formatBaseMoney = originalFormatMoney;
  window.theme.formatMoney = (cents) => `<span data-display-money data-cents="${Number(cents)}">${service.format(cents)}</span>`;
  window.theme.reconvertPrices = () => service.convertAll();

  class DisplayCurrencySelector extends HTMLElement {
    connectedCallback() {
      const select = this.querySelector("[data-display-currency-select]");
      if (!select || select.dataset.ready === "true") return;
      select.dataset.ready = "true";
      select.addEventListener("change", () => service.setCurrency(select.value));
      service.convertAll(this);
    }
  }
  if (!customElements.get("display-currency-selector")) {
    customElements.define("display-currency-selector", DisplayCurrencySelector);
  }

  service.convertAll();

  const cached = readStorage(ratesKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.savedAt < 12 * 60 * 60 * 1000 && parsed.rates) {
        rates = { ...rates, ...parsed.rates, USD: 1 };
        service.convertAll();
        return;
      }
    } catch { /* fetch a fresh copy */ }
  }

  fetch("https://api.frankfurter.app/latest?from=USD", { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`Rates request failed: ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      if (!payload?.rates) return;
      rates = { ...rates, ...payload.rates, USD: 1 };
      writeStorage(ratesKey, JSON.stringify({ savedAt: Date.now(), rates: payload.rates }));
      service.convertAll();
    })
    .catch(() => { /* configured fallback rates remain active */ });
})();
