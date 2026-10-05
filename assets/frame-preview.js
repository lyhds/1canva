if (!customElements.get("frame-preview")) {
/**
 * Interactive layered frame preview. Wraps the server-rendered
 * frame-preview snippet markup and swaps the nine-slice wood texture
 * (border-image source) instantly when the Frame option changes.
 *
 * Listens to window "variant:change" (from variant-picker), scoped to its
 * own .shopify-section so unrelated previews (product cards, other forms)
 * don't react.
 */
class FramePreview extends HTMLElement {
  connectedCallback() {
    this.box = this.querySelector("[data-frame-box]");
    this.mount = this.querySelector("[data-frame-mount]");
    const scene = this.closest('[data-artwork-scene]');
    if (scene && !scene.hasAttribute('data-scene-ready')) {
      // Wait for both the background and artwork, including cached images.
      const ready = [...scene.querySelectorAll('img')].map((img) => {
        const loaded = img.complete ? Promise.resolve() : new Promise((resolve) => {
          const finish = () => {
            img.removeEventListener('load', finish);
            img.removeEventListener('error', finish);
            resolve();
          };
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
        });
        return loaded.then(() => img.decode?.()).catch(() => {});
      });
      Promise.all(ready).then(() => scene.setAttribute('data-scene-ready', ''));
    }
    this.onVariantChange = (e) => {
      if (!e.detail?.frame) return;
      // ignore variant changes from other sections (e.g. related products)
      if (e.detail.source && !window.theme.sameSection(e.detail.source, this)) return;
      this.setFrame(e.detail.frame);
    };
    window.addEventListener('variant:change', this.onVariantChange);
  }

  disconnectedCallback() {
    window.removeEventListener('variant:change', this.onVariantChange);
  }

  setFrame(frame) {
    const material = window.theme.frameMaterial(frame);
    if (!this.box) return;
    if (!material) {
      this.box.dataset.frame = "none";
      this.box.style.removeProperty("--frame-tex");
      this.box.style.removeProperty("--frame-color");
    } else {
      this.box.dataset.frame = material.key;
      const tex = this.mount?.dataset[`tex${material.key[0].toUpperCase()}${material.key.slice(1)}`];
      if (tex) this.box.style.setProperty("--frame-tex", `url('${tex}')`);
      else this.box.style.removeProperty("--frame-tex");
      if (material.key === "white") this.box.style.setProperty("--frame-color", material.color);
      else this.box.style.removeProperty("--frame-color");
    }
  }
}

customElements.define("frame-preview", FramePreview);
}
