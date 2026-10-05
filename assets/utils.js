/**
 * Shared helpers. window.theme.formatMoney renders cents with the shop's
 * money format (injected by theme.liquid).
 */
window.theme = window.theme || {};

window.theme.formatMoney = function (cents, format) {
  const value = (cents / 100).toFixed(2);
  const fmt = format || window.theme.moneyFormat || "${{amount}}";
  return fmt.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    switch (key) {
      case "amount":
        return value;
      case "amount_no_decimals":
        return String(Math.round(cents / 100));
      case "amount_with_comma_separator":
        return value.replace(".", ",");
      case "amount_no_decimals_with_comma_separator":
        return String(Math.round(cents / 100));
      default:
        return value;
    }
  });
};

window.theme.reconvertPrices = function () {};

/** Float-frame colours by canonical key (see FRAME_ALIASES). */
const FRAME_COLORS = {
  oak: "#bc8f5c",
  black: "#171717",
  walnut: "#60402d",
  white: "#f2f0ea",
  gold: "#b08a43",
  silver: "#aeb0ae",
};

/**
 * Single alias table for stored Frame option values, mirroring the Liquid
 * snippet snippets/frame-key.liquid: current catalog values, legacy aliases
 * ("Oak frame", "wood") and bare colour names resolve case-insensitively.
 * scripts/frame-aliases.test.js keeps both lists identical.
 */
const FRAME_ALIASES = {
  "oak float frame": "oak",
  "oak frame": "oak",
  oak: "oak",
  wood: "oak",
  "black float frame": "black",
  "black frame": "black",
  black: "black",
  "walnut float frame": "walnut",
  "walnut frame": "walnut",
  walnut: "walnut",
  "white float frame": "white",
  "white frame": "white",
  white: "white",
  "gold float frame": "gold",
  "gold frame": "gold",
  gold: "gold",
  "silver float frame": "silver",
  "silver frame": "silver",
  silver: "silver",
};

/** Canonical float-frame key, or null for canvas-only and unknown values. */
window.theme.frameKey = function (frame) {
  return FRAME_ALIASES[String(frame ?? "").trim().toLowerCase()] || null;
};

window.theme.frameMaterial = function (frame) {
  const key = window.theme.frameKey(frame);
  return key ? { key, color: FRAME_COLORS[key] } : null;
};

window.theme.escapeHtml = function (value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
};

window.theme.imageWidthUrl = function (url, width) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("width", width);
  return parsed.href;
};

window.theme.frameArtMarkup = function (masterUrl, frame, alt = "", aspect = "portrait", exactAspect = null) {
  const material = window.theme.frameMaterial(frame);
  const key = material ? material.key : "none";
  const tex = material && window.theme.frameTextures ? window.theme.frameTextures[material.key] : null;
  const RATIOS = { 34: 0.75, 23: 0.6667, square: 1, 43: 1.3333, 32: 1.5, 21: 2, portrait: 0.8, landscape: 1.5 };
  const ar = Number(exactAspect) > 0 ? Number(exactAspect) : RATIOS[aspect] || 0.8;
  const src = window.theme.imageWidthUrl(masterUrl, 720);
  const srcset = [320, 480, 720, 960, 1200]
    .map((width) => `${window.theme.imageWidthUrl(masterUrl, width)} ${width}w`)
    .join(", ");
  return `<div class="frame-box" data-frame-box data-frame="${key}" role="img" aria-label="${window.theme.escapeHtml(alt)}"
    style="--ar:${ar};${tex ? `--frame-tex:url('${tex}')` : ""}">
      <img src="${src}" srcset="${srcset}" sizes="(min-width:640px) 210px, 45vw" alt="" class="frame-art-image" loading="lazy" decoding="async">
    </div>`;
};

/** Lock/unlock body scroll (modal, drawer, lightbox). */
window.theme.lockScroll = function (on) {
  document.documentElement.style.overflow = on ? "hidden" : "";
};

/**
 * Section scoping for window-level events (variant:change, lightbox:open):
 * components only react to events whose source lives in the same
 * .shopify-section wrapper, so e.g. PDP variant changes don't re-frame
 * related product cards.
 */
window.theme.sectionRoot = function (el) {
  return el?.closest?.(".shopify-section") || document;
};

window.theme.sameSection = function (a, b) {
  return window.theme.sectionRoot(a) === window.theme.sectionRoot(b);
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Minimal focus trap for overlays: focuses the first focusable element on
 * open, cycles Tab/Shift+Tab within the container, restores focus on close.
 */
window.theme.trapFocus = function (container, on) {
  if (!container) return;
  if (on) {
    container.__prevFocus = document.activeElement;
    const first = [...container.querySelectorAll(FOCUSABLE)].find(
      (el) => el.offsetParent !== null
    );
    first?.focus();
    container.__focusTrap = (e) => {
      if (e.key !== "Tab") return;
      const items = [...container.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null
      );
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        lastItem.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        firstItem.focus();
        e.preventDefault();
      }
    };
    container.addEventListener("keydown", container.__focusTrap);
  } else {
    container.removeEventListener("keydown", container.__focusTrap);
    container.__prevFocus?.focus?.();
  }
};
