if (!customElements.get("product-recommendations")) {
/**
 * Related products: fetches Shopify's product recommendations via the
 * Section Rendering API on first view and swaps the section content in.
 */
class ProductRecommendations extends HTMLElement {
  connectedCallback() {
    // section already rendered recommendations server-side (e.g. direct link
    // with ?product_id) — nothing to do
    if (this.querySelector("[data-recommendations-done]")) return;
    const observer = new IntersectionObserver(
      ([entry], io) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        this.load();
      },
      { rootMargin: "0px 0px 400px 0px" }
    );
    observer.observe(this);
  }

  async load() {
    try {
      const html = await fetch(this.dataset.url).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const fresh = doc.querySelector("product-recommendations");
      if (fresh && fresh.querySelector("[data-recommendations-done]")) {
        this.innerHTML = fresh.innerHTML;
        window.wishlist?.sync?.(); // paint heart states on the injected cards
      } else {
        this.remove(); // no recommendations — drop the empty section
      }
    } catch {
      /* keep the page quiet if recommendations fail */
    }
  }
}

customElements.define("product-recommendations", ProductRecommendations);
}
