/** Update the cart and its Liquid sections from one Shopify response. */
(() => {
  // Section HTML contains this script too; install delegated handlers only once.
  if (window.theme.cartInitialized) return;
  window.theme.cartInitialized = true;
  window.theme.cartBusy = false;

  function cartSectionIds() {
    return [...new Set(
      [...document.querySelectorAll("[data-cart-section]")].map((root) => root.dataset.cartSection)
    )];
  }
  window.theme.cartSectionIds = cartSectionIds;

  window.theme.cartSectionsUrl = function () {
    const url = new URL(window.location.href, window.location.origin);
    return url.pathname + url.search;
  };

  /**
   * Replace every [data-cart-section] root with its rendered counterpart from
   * the response's `sections` map, then sync the header count badges.
   */
  async function swapCartSections(cart) {
    if (!Number.isInteger(cart.item_count)) throw new Error("Missing cart item count");
    const roots = [...document.querySelectorAll("[data-cart-section]")];
    const freshRoots = [];
    for (const root of roots) {
      const sectionId = root.dataset.cartSection;
      const html = cart.sections?.[sectionId];
      if (typeof html !== "string") throw new Error("Missing cart section: " + sectionId);
      const parsed = new DOMParser().parseFromString(html, "text/html")
        .querySelector(`[data-cart-section="${sectionId}"]`);
      const fresh = parsed ? document.importNode(parsed, true) : null;
      if (!fresh || fresh.dataset.cartSection !== sectionId || !root.isConnected) {
        throw new Error("Cart section could not be replaced");
      }
      root.replaceWith(fresh);
      freshRoots.push(fresh);
    }
    document.querySelectorAll("[data-cart-count]").forEach((badge) => {
      badge.textContent = cart.item_count;
      badge.toggleAttribute("hidden", cart.item_count === 0);
    });
    window.theme.reconvertPrices?.();
    return freshRoots;
  }
  window.theme.swapCartSections = swapCartSections;

  function restoreFocus(root, key, action, previousIndex) {
    const rows = [...root.querySelectorAll("[data-cart-item]")];
    const sameRow = rows.find((row) => row.dataset.cartKey === key);
    const row = sameRow || rows[Math.min(previousIndex, rows.length - 1)];
    const target = sameRow?.querySelector(`[data-cart-change="${action}"]`)
      || row?.querySelector("[data-cart-item-link]")
      || root.querySelector("[data-cart-heading]");
    target?.focus({ preventScroll: true });
  }

  async function changeQty(button) {
    if (window.theme.cartBusy || button.disabled) return;
    const root = button.closest("[data-cart-section]");
    if (!root) return;
    window.theme.cartBusy = true;
    root.setAttribute("aria-busy", "true");
    root.classList.add("opacity-40");
    document.querySelectorAll("[data-cart-change], [name='checkout']").forEach((control) => {
      control.disabled = true;
    });
    const status = document.querySelector("[data-cart-status]");
    if (status) status.textContent = root.dataset.updatingText;

    try {
      const key = button.closest("[data-cart-item]")?.dataset.cartKey;
      const quantity = Number(button.dataset.quantity);
      const action = button.dataset.cartChange;
      const previousIndex = [...root.querySelectorAll("[data-cart-item]")]
        .findIndex((row) => row.dataset.cartKey === key);
      if (!key || !Number.isInteger(quantity) || quantity < 0) {
        throw new Error("Invalid cart update target");
      }
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
      let response;
      try {
        response = await fetch(window.theme.routes.cartChange.replace(/(?:\.js)?$/, ".js"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            id: key,
            quantity,
            sections: cartSectionIds(),
            sections_url: window.theme.cartSectionsUrl(),
          }),
          signal: controller?.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`Cart change failed: ${response.status}`);
      const cart = await response.json();
      if (!root.isConnected) throw new Error("Cart section was removed while updating");
      const freshRoots = await swapCartSections(cart);
      const freshRoot = freshRoots.find((node) => node.dataset.cartSection === root.dataset.cartSection) || root;
      if (status) status.textContent = freshRoot.dataset.updatedText;
      window.theme.cartBusy = false;
      restoreFocus(document, key, action, previousIndex);
    } catch (error) {
      // The mutation may already have succeeded. Never retry it or re-enable
      // checkout on stale HTML; reload once to recover the authoritative cart.
      console.error("Cart update failed:", error);
      window.location.reload();
    }
  }

  // Capture phase outruns third-party bubble listeners; the bubble pass is a
  // fallback for engines without capture. changeQty's busy guard dedupes.
  const onCartClick = (event) => {
    const button = event.target.closest("[data-cart-change]");
    if (!button) return;
    event.preventDefault();
    void changeQty(button);
  };
  document.addEventListener("click", onCartClick, true);
  document.addEventListener("click", onCartClick);
  document.addEventListener("submit", (event) => {
    if (window.theme.cartBusy && event.target.closest("[data-cart-section]")) event.preventDefault();
  });
})();
