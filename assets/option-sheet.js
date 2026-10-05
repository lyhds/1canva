if (!customElements.get("option-sheet")) {
/**
 * Bottom-sheet option picker (mobile PDP): slides up over a backdrop,
 * closes on backdrop/Esc/close button. Sheets marked close-on-select also
 * close after a valid option is picked; other sheets stay open so customers
 * can compare visual options. The option buttons inside reuse the
 * variant-picker's data-option-button contract, so all state (pressed,
 * prices, sold-out, preview sync) stays in one place.
 */
class OptionSheet extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector("[data-sheet-panel]");
    this.backdrop = this.querySelector("[data-sheet-backdrop]");
    document
      .querySelectorAll(`[data-sheet-open="${this.id}"]`)
      .forEach((b) => b.addEventListener("click", () => this.open()));
    this.querySelectorAll("[data-sheet-close]").forEach((b) =>
      b.addEventListener("click", () => this.close())
    );
    if (this.hasAttribute("close-on-select")) {
      this.querySelectorAll("[data-option-button]").forEach((b) =>
        b.addEventListener("click", () => {
          if (!b.hasAttribute("data-soldout")) this.close();
        })
      );
    }
    this.backdrop?.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.classList.contains("is-open")) this.close();
    });
  }

  open() {
    this.classList.add("is-open");
    this.backdrop.classList.remove("opacity-0", "invisible");
    this.panel.classList.remove("translate-y-full", "invisible");
    window.theme.lockScroll(true);
    window.theme.trapFocus(this.panel, true);
  }

  close() {
    this.classList.remove("is-open");
    this.backdrop.classList.add("opacity-0", "invisible");
    this.panel.classList.add("translate-y-full", "invisible");
    window.theme.lockScroll(false);
    window.theme.trapFocus(this.panel, false);
  }
}

customElements.define("option-sheet", OptionSheet);
}
