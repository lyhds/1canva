import vm from "node:vm";
import { parseHTML } from "linkedom";
import { read } from "./theme-fixtures.js";

export const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

export function browserDom(html, { fetch = async () => { throw new Error("Unexpected fetch"); }, saved = [] } = {}) {
  const { window, document } = parseHTML(html);
  const storage = new Map([["makeready-wishlist", JSON.stringify(saved)]]);
  let reloads = 0;
  Object.defineProperty(document, "activeElement", { value: document.body, writable: true, configurable: true });
  window.HTMLElement.prototype.focus = function () { this.ownerDocument.activeElement = this; };
  const fakeWindow = {
    theme: { moneyFormat: "${{amount}}", routes: { root: "/", cart: "/cart", cartChange: "/cart/change" } },
    location: { origin: "http://localhost", href: "/cart", reload: () => { reloads++; } },
    addEventListener: window.addEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
  };
  const scope = vm.createContext({
    window: fakeWindow, document, DOMParser: window.DOMParser, CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement,
    URL, fetch, console: { error() {} }, AbortController, setTimeout, clearTimeout,
    customElements: { get() {}, define() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  return {
    document, window: fakeWindow, scope, storage,
    get reloads() { return reloads; },
    run(name) { vm.runInContext(read(`assets/${name}`), scope); },
    click(selector) {
      const target = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!target) throw new Error(`Missing click target: ${selector}`);
      target.focus();
      target.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    },
    submit() {
      const event = new window.Event("submit", { bubbles: true, cancelable: true });
      document.querySelector("[data-cart-section] form").dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
}
