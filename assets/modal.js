if (!customElements.get("modal-dialog")) {
/**
 * Minimal modal dialog: opens via [data-modal-open="<id>"], closes on Esc,
 * backdrop click or [data-modal-close]. Body scroll locked while open.
 */
class ModalDialog extends HTMLElement {
  connectedCallback() {
    document.querySelectorAll(`[data-modal-open="${this.id}"]`).forEach((b) =>
      b.addEventListener("click", () => this.open())
    );
    this.querySelectorAll("[data-modal-close]").forEach((b) =>
      b.addEventListener("click", () => this.close())
    );
    this.addEventListener("click", (e) => {
      if (e.target === this) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.classList.contains("hidden")) this.close();
    });
  }

  open() {
    this.classList.remove("hidden");
    this.classList.add("flex");
    window.theme.lockScroll(true);
    window.theme.trapFocus(this, true);
  }

  close() {
    this.classList.add("hidden");
    this.classList.remove("flex");
    window.theme.lockScroll(false);
    window.theme.trapFocus(this, false);
  }
}

customElements.define("modal-dialog", ModalDialog);
}
