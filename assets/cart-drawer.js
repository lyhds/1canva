/**
 * Cart drawer: slide-in panel with the server-rendered cart section.
 * Intercepts add-to-cart submissions (AJAX add + section swap + open),
 * and lets the header cart button open the drawer instead of navigating.
 */
(() => {
  if (window.theme.cartDrawerInitialized) return;
  window.theme.cartDrawerInitialized = true;

  class CartDrawer extends HTMLElement {
    connectedCallback() {
      this.scrim = this.querySelector("[data-cart-drawer-scrim]");
      this.panel = this.querySelector("[data-cart-drawer-panel]");
      this.scrim?.addEventListener("click", () => this.close());
      this.querySelector("[data-cart-drawer-close]")?.addEventListener("click", () => this.close());
      this.addEventListener("click", (event) => {
        if (event.target.closest("a")) this.close();
      });
    }

    open() {
      this.classList.add("is-open");
      this.setAttribute("aria-hidden", "false");
      this.scrim?.classList.remove("opacity-0", "invisible");
      this.panel?.classList.remove("translate-x-full", "invisible");
      window.theme.lockScroll(true);
      window.theme.trapFocus(this.panel, true);
    }

    close() {
      this.classList.remove("is-open");
      this.setAttribute("aria-hidden", "true");
      this.scrim?.classList.add("opacity-0", "invisible");
      this.panel?.classList.add("translate-x-full", "invisible");
      window.theme.lockScroll(false);
      window.theme.trapFocus(this.panel, false);
    }
  }

  if (!customElements.get("cart-drawer")) customElements.define("cart-drawer", CartDrawer);

  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-cart-drawer-open]");
    if (!opener) return;
    event.preventDefault();
    document.querySelector("cart-drawer")?.open?.();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const drawer = document.querySelector("cart-drawer");
    if (drawer?.classList.contains("is-open")) drawer.close?.();
  });

  async function addToCart(form, degraded = false) {
    const id = form.querySelector('[name="id"]')?.value;
    const quantity = Number(form.querySelector('[name="quantity"]')?.value || 1);
    const button = form.querySelector("[data-atc]") || form.querySelector('[type="submit"]');
    if (!id || !Number.isInteger(quantity) || quantity < 1) {
      showError(form, "Please select an available option and a valid quantity.");
      return;
    }
    window.theme.cartBusy = true;
    form.querySelector("[data-cart-add-error]")?.remove();
    button?.setAttribute("disabled", "");
    try {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
      let response;
      try {
        response = await fetch(window.theme.routes.cartAdd + ".js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            id,
            quantity,
            sections: degraded ? [] : window.theme.cartSectionIds(),
            sections_url: window.theme.cartSectionsUrl?.() || new URL(window.location.href, window.location.origin).pathname,
          }),
          signal: controller?.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        // Never re-post a failed request: a section-rendering error can occur
        // after Shopify has already added the item.
        const error = await response.json().catch(() => ({}));
        showError(form, error.description || error.message || "Unable to confirm the cart update. Please check your cart before trying again.");
        return;
      }
      const added = await response.json();
      // add.js returns added line items, not the cart total. Read the current
      // cart separately; keep the section HTML bundled with the successful add.
      const cartResponse = await fetch(window.theme.routes.cart.replace(/(?:\.js)?$/, ".js"), {
        headers: { Accept: "application/json" }, cache: "no-store",
        signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(10000) : undefined,
      });
      if (!cartResponse.ok) throw new Error("Unable to read cart");
      const cart = await cartResponse.json();
      cart.sections = added.sections;
      if (!Number.isInteger(cart.item_count)) throw new Error("Invalid cart response");
      if (degraded) {
        window.location.reload();
        return;
      }
      await window.theme.swapCartSections(cart);
      document.querySelector("cart-drawer")?.open?.();
    } catch (error) {
      // The add may already have succeeded. Stay on the product and never
      // re-post automatically, which could add the same item twice.
      console.error("Add to cart failed:", error);
      showError(form, "Unable to confirm the cart update. Please check your cart before trying again.");
    } finally {
      window.theme.cartBusy = false;
      button?.removeAttribute("disabled");
    }
  }

  function showError(form, message) {
    let status = form.querySelector("[data-cart-add-error]");
    if (!status) {
      status = document.createElement("p");
      status.setAttribute("data-cart-add-error", "");
      status.setAttribute("role", "alert");
      form.append(status);
    }
    status.textContent = message;
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest('form[action*="/cart/add"]');
    if (!form) return;
    // Never let an add-to-cart fall through to a full page navigation.
    event.preventDefault();
    if (window.theme.cartBusy) return;
    void addToCart(form, typeof window.theme.swapCartSections !== "function");
  }, true);
})();
