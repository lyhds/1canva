if (!customElements.get("predictive-search")) {
/**
 * Predictive search overlay: full-screen search with debounced quick results
 * from the Predictive Search API and a "view all results" link.
 */
class PredictiveSearch extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector("input");
    this.results = this.querySelector("[data-search-results]");
    this.openButtons = [...document.querySelectorAll("[data-search-open]")];
    this.closeButtons = [...this.querySelectorAll("[data-search-close]")];
    this.handleOpen = () => this.open();
    this.handleClose = () => this.close();
    this.handleInput = () => this.onInput();
    this.handleInputKeydown = (event) => {
      if (event.key === "Enter") this.viewAll();
    };
    this.handleDocumentKeydown = (event) => {
      if (event.key === "Escape" && !this.classList.contains("hidden")) this.close();
    };
    this.openButtons.forEach((button) => button.addEventListener("click", this.handleOpen));
    this.closeButtons.forEach((button) => button.addEventListener("click", this.handleClose));
    this.input.addEventListener("input", this.handleInput);
    this.input.addEventListener("keydown", this.handleInputKeydown);
    document.addEventListener("keydown", this.handleDocumentKeydown);
    this.debounce = null;
    this.controller = null;
  }

  disconnectedCallback() {
    this.openButtons?.forEach((button) => button.removeEventListener("click", this.handleOpen));
    this.closeButtons?.forEach((button) => button.removeEventListener("click", this.handleClose));
    this.input?.removeEventListener("input", this.handleInput);
    this.input?.removeEventListener("keydown", this.handleInputKeydown);
    document.removeEventListener("keydown", this.handleDocumentKeydown);
    clearTimeout(this.debounce);
    this.controller?.abort();
  }

  open() {
    this.classList.remove("hidden");
    window.theme.lockScroll(true);
    window.theme.trapFocus(this, true);
    this.input.focus();
  }

  close() {
    this.classList.add("hidden");
    window.theme.lockScroll(false);
    window.theme.trapFocus(this, false);
  }

  onInput() {
    clearTimeout(this.debounce);
    const q = this.input.value.trim();
    if (!q) {
      this.controller?.abort();
      this.render([]);
      return;
    }
    this.debounce = setTimeout(() => this.fetchResults(q), 250);
  }

  async fetchResults(q) {
    this.controller?.abort();
    this.controller = new AbortController();
    const url = `${window.theme.routes.predictiveSearch}.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=8&resources[options][fields]=title,vendor,product_type`;
    try {
      const response = await fetch(url, { signal: this.controller.signal });
      if (!response.ok) throw new Error(`Predictive search failed: ${response.status}`);
      const data = await response.json();
      if (this.input.value.trim() !== q) return; // stale response
      this.render(data.resources?.results?.products ?? [], q);
    } catch (error) {
      if (error.name === "AbortError" || this.input.value.trim() !== q) return;
      this.renderError();
    }
  }

  viewAll() {
    const q = this.input.value.trim();
    if (q) window.location.href = `${window.theme.routes.search}?q=${encodeURIComponent(q)}`;
  }

  render(products, q) {
    const escape = window.theme.escapeHtml;
    if (!q) {
      this.results.innerHTML = `<p class="font-sans text-[14px] text-neutral-500">${escape(this.dataset.hint)}</p>`;
      return;
    }
    if (products.length === 0) {
      this.results.innerHTML = `<p class="font-sans text-[14px] text-neutral-500">${escape(this.dataset.empty)} &#8220;${escape(q)}&#8221;.</p>`;
      return;
    }
    const cards = products
      .map((p) => {
        const cents = Math.round(parseFloat(p.price) * 100);
        const min = parseFloat(p.price_min);
        const max = parseFloat(p.price_max);
        const priceVaries = Number.isFinite(min) && Number.isFinite(max) && min < max;
        const price = Number.isFinite(cents) ? window.theme.formatMoney(cents) : "";
        const compareMin = parseFloat(p.compare_at_price_min);
        const compareLabel = Number.isFinite(compareMin) && Math.round(compareMin * 100) > cents
          ? `<s class="mr-1 font-normal text-neutral-400">${window.theme.formatMoney(Math.round(compareMin * 100))}</s> `
          : "";
        const priceLabel = price && priceVaries
          ? this.dataset.fromPrice.replace("__PRICE__", () => price)
          : price;
        const safeUrl = escape(p.url || "");
        const safeImage = escape(p.image || "");
        const safeTitle = escape(p.title || "");
        const safeVendor = escape(p.vendor || "");
        const image = safeImage
          ? `<img src="${safeImage}" alt="${safeTitle}" loading="lazy" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]">`
          : "";
        return `
        <a href="${safeUrl}" class="group">
          <div class="aspect-[4/5] w-full overflow-hidden bg-[#f3f3f3]">
            ${image}
          </div>
          <p class="mt-3 font-serif text-[19px] leading-[1.3] text-black">${safeTitle}</p>
          <p class="mt-1 font-sans text-[14px] leading-[1.5] text-neutral-600">${safeVendor}</p>
          <p class="mt-1 font-sans text-[16px] font-medium leading-[1.5] text-black">${compareLabel}${priceLabel}</p>
        </a>`;
      })
      .join("");
    this.results.innerHTML = `
      <div class="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">${cards}</div>
      <button data-search-viewall class="mt-10 inline-flex items-center gap-2 border border-black px-8 py-3.5 font-sans text-[14px] text-black transition-colors hover:bg-black hover:text-white">
        ${escape(this.dataset.viewAll)} <span aria-hidden="true">→</span>
      </button>`;
    window.theme.reconvertPrices?.();
    this.results
      .querySelector("[data-search-viewall]")
      .addEventListener("click", () => this.viewAll());
  }

  renderError() {
    this.results.innerHTML = `<p class="font-sans text-[14px] text-neutral-500">${window.theme.escapeHtml(this.dataset.error)}</p>`;
  }
}

customElements.define("predictive-search", PredictiveSearch);
}
