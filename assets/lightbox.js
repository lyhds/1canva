if (!customElements.get("image-lightbox")) {
/**
 * Full-screen image viewer with one-step zoom — the stage image itself is
 * the zoom surface (no separate zoom layer). Desktop: wheel zooms at the
 * cursor, drag pans, double-click toggles 1↔2.5×. Touch: pinch zooms
 * (1–5×), drag pans while zoomed, single-finger horizontal swipe switches
 * images at 1×, double-tap toggles zoom. Backdrop tap / Esc close.
 * Arrows, thumbnails and arrow keys switch images. Opens on window
 * "lightbox:open" ({ index, source }).
 */
const MAX_SCALE = 5;
const DBL_SCALE = 2.5;
const SWIPE_PX = 50;
const TAP_MS = 400;
const TAP_PX = 25;

class ImageLightbox extends HTMLElement {
  connectedCallback() {
    this.stage = this.querySelector("[data-lightbox-stage]");
    this.img = this.querySelector("[data-lightbox-current]");
    this.originalImg = this.img;
    this.images = JSON.parse(this.querySelector("[data-lightbox-images]").textContent);
    this.thumbs = [...this.querySelectorAll("[data-lightbox-thumb]")];
    this.active = 0;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.pointers = new Map();
    this.gesture = null;
    this.moved = false;
    this.tap = null;
    this.pushed = false;

    window.addEventListener("lightbox:open", (e) => {
      if (e.detail?.source && !window.theme.sameSection(e.detail.source, this)) return;
      this.open(e.detail?.index ?? 0);
    });
    // Back/forward, and a page restored from the back-forward cache, must never leave
    // the overlay covering the page it returns to.
    window.addEventListener("popstate", () => {
      if (!this.classList.contains("hidden")) this.close({ fromHistory: true });
      else this.pushed = false;
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted && !this.classList.contains("hidden")) this.close({ fromHistory: true });
    });
    this.querySelectorAll("[data-lightbox-close]").forEach((b) =>
      b.addEventListener("click", () => this.close())
    );
    this.querySelector("[data-lightbox-prev]")?.addEventListener("click", () =>
      this.jumpTo(this.active - 1)
    );
    this.querySelector("[data-lightbox-next]")?.addEventListener("click", () =>
      this.jumpTo(this.active + 1)
    );
    this.thumbs.forEach((t, i) => t.addEventListener("click", () => this.jumpTo(i)));

    this.stage?.addEventListener("pointerdown", (e) => this.onDown(e));
    document.addEventListener("pointermove", (e) => this.onMove(e));
    document.addEventListener("pointerup", (e) => this.onUp(e));
    document.addEventListener("pointercancel", (e) => this.onUp(e));

    this.stage?.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, this.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), false);
      },
      { passive: false }
    );

    document.addEventListener("keydown", (e) => {
      if (this.classList.contains("hidden")) return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") this.jumpTo(this.active + 1);
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") this.jumpTo(this.active - 1);
    });
  }

  open(index) {
    const wasHidden = this.classList.contains("hidden");
    this.classList.remove("hidden");
    window.theme.lockScroll(true);
    window.theme.trapFocus(this, true);
    this.setActive(index);
    // Own one history entry while the viewer is open, so the browser Back button
    // closes it first. Without an entry, Back navigates away and the overlay stays
    // on screen over the page the visitor lands on.
    if (wasHidden && !this.pushed && window.history?.pushState) {
      this.pushed = true;
      window.history.pushState({ ...(window.history.state || {}), canvasraLightbox: true }, "");
    }
  }

  close(options = {}) {
    const wasOpen = !this.classList.contains("hidden");
    this.classList.add("hidden");
    window.theme.lockScroll(false);
    window.theme.trapFocus(this, false);
    this.reset();
    if (!this.pushed) return;
    this.pushed = false;
    // A Back press already consumed the entry; closing from the page must consume it.
    if (wasOpen && !options.fromHistory) window.history?.back?.();
  }

  jumpTo(i) {
    if (!this.images.length) return;
    const target = ((i % this.images.length) + this.images.length) % this.images.length;
    const indices = this.closest('.shopify-section')?.querySelector('product-gallery')?.visibleIndices;
    if (!indices || indices.includes(target)) this.setActive(target);
    else this.setActive(i < this.active ? indices.at(-1) : indices[0]);
  }

  setActive(i) {
    this.active = i;
    const item = this.images[i];
    this.composite?.remove();
    this.composite = null;
    this.img = this.originalImg;
    this.originalImg.style.display = '';
    const section = this.closest('.shopify-section');
    const slide = section?.querySelectorAll('[data-gallery-slide]')[i];
    const layered = slide?.querySelector('[data-artwork-scene]') || slide?.querySelector('frame-preview');
    if (layered) {
      this.composite = layered.cloneNode(true);
      const ratio = Number(item?.width) / Number(item?.height);
      const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      this.composite.style.cssText = `position:relative;display:block;flex:none;width:min(100cqw,calc(100cqh * ${aspect}));height:auto;aspect-ratio:${aspect};user-select:none`;
      this.composite.querySelectorAll('img').forEach(image => { image.draggable = false; image.loading = 'eager'; });
      this.stage.append(this.composite);
      this.originalImg.style.display = 'none';
      this.img = this.composite;
    }
    if (item && this.img === this.originalImg) {
      this.img.src = item.src;
      this.img.alt = item.alt;
      this.img.width = item.width;
      this.img.height = item.height;
    }
    this.reset();
    this.thumbs.forEach((t, j) => {
      t.classList.toggle("border-black", j === i);
      t.classList.toggle("border-black/15", j !== i);
    });
  }

  reset() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.pointers.clear();
    this.gesture = null;
    this.tap = null;
    this.apply(false);
  }

  /** Scale around a viewport point (cursor / pinch midpoint), clamped 1–5×. */
  zoomAt(cx, cy, next, animate = true) {
    const target = Math.min(MAX_SCALE, Math.max(1, next));
    if (target === this.scale) return;
    const r = this.stage.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2;
    const oy = cy - r.top - r.height / 2;
    this.tx = ox - ((ox - this.tx) * target) / this.scale;
    this.ty = oy - ((oy - this.ty) * target) / this.scale;
    this.scale = target;
    this.apply(animate);
  }

  toggleZoom(cx, cy) {
    this.zoomAt(cx, cy, this.scale > 1 ? 1 : DBL_SCALE);
  }

  /** Single writer for the image transform. scale 1 always recentres. */
  apply(animate) {
    if (!this.img || !this.stage) return;
    this.img.style.transition = animate ? "" : "none";
    if (this.scale <= 1) {
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
    } else {
      const r = this.stage.getBoundingClientRect();
      const overX = Math.max(0, (this.scale * this.img.offsetWidth - r.width) / 2);
      const overY = Math.max(0, (this.scale * this.img.offsetHeight - r.height) / 2);
      this.tx = Math.min(overX, Math.max(-overX, this.tx));
      this.ty = Math.min(overY, Math.max(-overY, this.ty));
      this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
      return;
    }
    this.img.style.transform = "";
  }

  onDown(e) {
    if (this.classList.contains("hidden")) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.img.style.transition = "none";
    this.moved = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        mode: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: this.scale,
        tx: this.tx,
        ty: this.ty,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    } else if (this.pointers.size === 1) {
      this.gesture = {
        mode: this.scale > 1 || e.pointerType === "mouse" ? "pan" : "swipe",
        tx: this.tx,
        ty: this.ty,
        sx: e.clientX,
        sy: e.clientY,
        t: performance.now(),
      };
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.gesture.mode === "pinch") {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.scale = Math.min(
        MAX_SCALE,
        Math.max(1, this.gesture.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.gesture.dist))
      );
      this.tx = this.gesture.tx + mx - this.gesture.mx;
      this.ty = this.gesture.ty + my - this.gesture.my;
      this.moved = true;
      this.apply(false);
    } else if (this.gesture.mode === "pan") {
      const dx = e.clientX - this.gesture.sx;
      const dy = e.clientY - this.gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.moved = true;
      this.tx = this.gesture.tx + dx;
      this.ty = this.gesture.ty + dy;
      this.apply(false);
    } else {
      const dx = e.clientX - this.gesture.sx;
      const dy = e.clientY - this.gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.moved = true;
      // rubber-band the 1× image horizontally while the swipe is in flight
      this.img.style.transform = `translate(${dx * 0.35}px, 0)`;
    }
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);

    if (this.gesture?.mode === "pinch") {
      if (this.pointers.size === 1) {
        // pinch → one finger left: continue as pan without a jump
        const p = [...this.pointers.values()][0];
        this.gesture = { mode: "pan", tx: this.tx, ty: this.ty, sx: p.x, sy: p.y };
      } else if (this.pointers.size === 0) {
        this.gesture = null;
        this.apply(true);
      }
      return;
    }
    if (this.pointers.size > 0) return;

    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    const dt = performance.now() - g.t;

    if (g.mode === "swipe" && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      this.jumpTo(this.active + (dx < 0 ? 1 : -1));
      return;
    }
    this.apply(true);

    if (this.moved || dt > TAP_MS) return;
    const isDoubleTap =
      this.tap &&
      performance.now() - this.tap.t < TAP_MS &&
      Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) < TAP_PX;
    if (isDoubleTap) {
      this.tap = null;
      this.toggleZoom(e.clientX, e.clientY);
    } else if (e.target === this.stage) {
      this.close();
    } else {
      this.tap = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  }
}

customElements.define("image-lightbox", ImageLightbox);
}
