if (!customElements.get("sticky-atc")) {
/**
 * Mobile sticky add-to-cart bar: slides in once the main buy row scrolls out
 * of view at the top, hides when it re-enters. Its button submits the real
 * product form; price and availability mirror "variant:change".
 */
class StickyAtc extends HTMLElement {
  connectedCallback() {
    this.target = document.querySelector("[data-buy-row]");
    if (!this.target) return;
    this.price = this.querySelector("[data-sticky-price]");
    this.compare = this.querySelector("[data-sticky-compare]");
    this.button = this.querySelector("[data-sticky-button]");
    this.buttonText = this.querySelector("[data-sticky-button-text]");

    new IntersectionObserver(
      ([entry]) => {
        const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        this.classList.toggle("translate-y-0", show);
        this.classList.toggle("translate-y-full", !show);
        this.classList.toggle("invisible", !show);
        this.setAttribute("aria-hidden", String(!show));
      },
      { threshold: 0 }
    ).observe(this.target);

    this.button.addEventListener("click", () => {
      document.querySelector("[data-atc]")?.click();
    });

    window.addEventListener("variant:change", (e) => {
      if (e.detail?.source && !window.theme.sameSection(e.detail.source, this)) return;
      const v = e.detail?.variant;
      if (!v) return;
      if (this.price) this.price.innerHTML = window.theme.formatMoney(v.price);
      if (this.compare) {
        const sale = v.compare_at_price && v.compare_at_price > v.price;
        this.compare.innerHTML = sale ? window.theme.formatMoney(v.compare_at_price) : "";
        this.compare.classList.toggle("hidden", !sale);
      }
      const enabled = v.available;
      this.button.disabled = !enabled;
      this.button.classList.toggle("opacity-30", !enabled);
      this.buttonText.textContent = enabled ? this.dataset.addText : this.dataset.soldOutText;
    });
  }
}

customElements.define("sticky-atc", StickyAtc);
}
