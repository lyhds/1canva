if (!customElements.get("slider-component")) {
/**
 * Horizontal slider: scrollable track + prev/next arrows (desktop hover).
 * Used by related products and home carousel rows.
 */
class SliderComponent extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector("[data-slider-track]");
    this.prev = this.querySelector("[data-slider-prev]");
    this.next = this.querySelector("[data-slider-next]");
    if (!this.track) return;
    this.prev?.addEventListener("click", () => this.page(-1));
    this.next?.addEventListener("click", () => this.page(1));
    this.track.addEventListener("scroll", () => this.sync(), { passive: true });
    this.initDrag();
    this.sync();
  }

  page(dir) {
    const item = this.track.querySelector("[data-slider-item]");
    const step = item ? item.offsetWidth + 20 : this.track.clientWidth * 0.8;
    this.track.scrollBy({ left: dir * step * 2, behavior: "smooth" });
  }

  initDrag() {
    const track = this.track;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let moved = false;

    track.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      startX = e.clientX;
      startScroll = track.scrollLeft;
      dragging = true;
      moved = false;
    });

    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        track.setPointerCapture(e.pointerId);
        track.classList.add("is-dragging");
      }
      if (moved) track.scrollLeft = startScroll - dx;
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      track.classList.remove("is-dragging");
    };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);

    // swallow the click that follows a drag so it doesn't open the product
    track.addEventListener(
      "click",
      (e) => {
        if (moved) {
          e.preventDefault();
          e.stopPropagation();
          moved = false;
        }
      },
      true
    );

    track.addEventListener("dragstart", (e) => e.preventDefault());
  }

  sync() {
    const max = this.track.scrollWidth - this.track.clientWidth - 2;
    // inline display overrides the `hidden lg:flex` base classes cleanly
    if (this.prev) this.prev.style.display = this.track.scrollLeft <= 2 ? "none" : "";
    if (this.next) this.next.style.display = this.track.scrollLeft >= max ? "none" : "";
  }
}

customElements.define("slider-component", SliderComponent);
}
