/**
 * Wishlist: localStorage-backed saved product handles, shared across the theme.
 * Legacy numeric product ids are recognised while the wishlist page migrates
 * them to handles. Exposes window.wishlist and syncs every
 * [data-wishlist-count] badge. Fires "wishlist:change" on updates.
 */
const STORAGE_KEY = "makeready-wishlist";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw)
      ? [...new Set(raw.filter((item) => typeof item === "string" && item))]
      : [];
  } catch {
    return [];
  }
}

function write(items) {
  const uniqueItems = [...new Set(items.filter((item) => typeof item === "string" && item))];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uniqueItems));
  } catch {
    /* ignore */
  }
  syncBadges(uniqueItems);
  window.dispatchEvent(
    new CustomEvent("wishlist:change", { detail: { items: uniqueItems, ids: uniqueItems } })
  );
}

function syncBadges(items = read()) {
  document.querySelectorAll("[data-wishlist-count]").forEach((el) => {
    el.textContent = items.length;
    // the [hidden] attribute is !important in the Tailwind preflight, so it
    // wins over the badge's display utility regardless of CSS order
    el.toggleAttribute("hidden", items.length === 0);
  });
}

window.wishlist = {
  // `ids` remains as a compatibility alias for older theme code.
  ids: read,
  items: read,
  has(key, legacyId) {
    const items = read();
    return items.includes(key) || Boolean(legacyId && items.includes(legacyId));
  },
  toggle(key, legacyId) {
    const items = read();
    const saved = items.includes(key) || Boolean(legacyId && items.includes(legacyId));
    write(
      saved
        ? items.filter((item) => item !== key && item !== legacyId)
        : [...items, key]
    );
  },
  remove(key, legacyId) {
    write(read().filter((item) => item !== key && item !== legacyId));
  },
  replace(items) {
    write(items);
  },
  /** re-paint badges + toggles (call after injecting cards dynamically) */
  sync() {
    syncBadges();
    syncToggles();
  },
};

/** Paint every [data-wishlist-toggle] button to reflect saved state. */
function syncToggles() {
  const items = read();
  document.querySelectorAll("[data-wishlist-toggle]").forEach((btn) => {
    const saved =
      items.includes(btn.dataset.wishlistToggle) ||
      Boolean(btn.dataset.productId && items.includes(btn.dataset.productId));
    btn.setAttribute("aria-pressed", String(saved));
    btn.querySelectorAll("svg").forEach((svg) => svg.classList.toggle("fill-black", saved));
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-wishlist-toggle]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  window.wishlist.toggle(btn.dataset.wishlistToggle, btn.dataset.productId);
});

window.addEventListener("wishlist:change", syncToggles);
syncBadges();
syncToggles();
