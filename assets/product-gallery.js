if (!customElements.get("product-gallery")) {
/**
 * PDP gallery: one swipeable scroll-snap track with mobile dots and desktop
 * thumbnails. Every control uses an explicit slide index so both navigation
 * sets can coexist without changing the number of gallery slides.
 */
class ProductGallery extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector("[data-gallery-track]");
    this.thumbs = [...this.querySelectorAll("[data-gallery-thumb]")];
    this.prev = this.querySelector("[data-gallery-prev]");
    this.next = this.querySelector("[data-gallery-next]");
    this.mediaQuery = window.matchMedia?.('(min-width: 1024px)');
    this.active = this.visibleIndices[0] ?? 0;
    this.onViewportChange = () => {
      this.active = this.visibleIndices.includes(this.active) ? this.active : this.visibleIndices[0];
      this.goTo(this.active, 'instant');
      this.updateControls();
    };
    this.mediaQuery?.addEventListener('change', this.onViewportChange);
    this.raf = 0;
    if (!this.track) return;

    this.track.addEventListener("scroll", () => this.onScroll(), { passive: true });
    this.thumbs.forEach((control) =>
      control.addEventListener("click", () => this.goTo(Number(control.dataset.galleryIndex)))
    );
    this.prev?.addEventListener("click", () => this.move(-1));
    this.next?.addEventListener("click", () =>
      this.move(1)
    );
    this.track.querySelectorAll("[data-gallery-slide]").forEach((s, i) =>
      s.addEventListener("click", () => {
        // ignore the click that ends a swipe
        if (this.moved) return;
        window.dispatchEvent(
          new CustomEvent("lightbox:open", { detail: { index: i, source: this } })
        );
      })
    );

    this.updateControls();

    // Explicit frame selections always reveal the master artwork preview.
    window.addEventListener("variant:change", (e) => {
      if (e.detail?.source && !window.theme.sameSection(e.detail.source, this)) return;
      const slide = this.track.querySelectorAll('[data-gallery-slide]')[this.active];
      if (slide?.querySelector('[data-artwork-scene]') && e.detail?.selectedOption?.toLowerCase() !== 'frame') return;
      const slides = [...this.track.querySelectorAll('[data-gallery-slide]')];
      const masterIndex = slides.findIndex(s => !s.querySelector('[data-artwork-scene]') && s.querySelector('frame-preview'));
      this.goTo(masterIndex < 0 ? 0 : masterIndex);
    });
  }

  disconnectedCallback() {
    this.mediaQuery?.removeEventListener('change', this.onViewportChange);
  }

  get visibleIndices() {
    return [...(this.track?.querySelectorAll('[data-gallery-slide]') || [])]
      .map((_, index) => index)
      .filter(index => !(index === 0 && this.hasAttribute('data-desktop-skip-lead') && this.mediaQuery?.matches));
  }

  get count() { return this.visibleIndices.length; }

  move(direction) {
    const indices = this.visibleIndices;
    if (indices.length < 2) return;
    const position = (indices.indexOf(this.active) + direction + indices.length) % indices.length;
    this.goTo(indices[position]);
  }

  goTo(i, behavior = 'smooth') {
    const indices = this.visibleIndices;
    const position = Math.max(0, indices.indexOf(i));
    this.track.scrollTo({ left: position * this.track.clientWidth, behavior });
  }

  updateControls() {
    const position = this.visibleIndices.indexOf(this.active);
    const counter = this.querySelector("[data-gallery-count]");
    if (counter) counter.textContent = `${position + 1} / ${this.count}`;
    this.thumbs.forEach(control => {
      const isCurrent = Number(control.dataset.galleryIndex) === this.active;
      control.setAttribute('aria-current', String(isCurrent));
      if (control.hasAttribute('data-gallery-dot')) {
        const marker = control.querySelector('[data-gallery-marker]');
        marker?.classList.toggle('bg-black', isCurrent);
        marker?.classList.toggle('bg-black/25', !isCurrent);
      } else {
        control.classList.toggle('border-black', isCurrent);
        control.classList.toggle('border-black/15', !isCurrent);
      }
    });
    if (this.prev) this.prev.style.display = this.count < 2 ? 'none' : '';
    if (this.next) this.next.style.display = this.count < 2 ? 'none' : '';
  }

  onScroll() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const i = Math.round(this.track.scrollLeft / this.track.clientWidth);
      const clamped = this.visibleIndices[Math.max(0, Math.min(this.count - 1, i))] ?? 0;
      this.moved = true;
      clearTimeout(this.movedTimer);
      this.movedTimer = setTimeout(() => (this.moved = false), 60);
      if (clamped === this.active) return;
      this.active = clamped;
      this.updateControls();
    });
  }
}

customElements.define("product-gallery", ProductGallery);
}
