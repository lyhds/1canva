if (!customElements.get("size-guide-modal")) {
  const BASE_MODAL = customElements.get("modal-dialog");
  const SG_SCENES = {
    sofa: { defaultWidthCm: 213.36, furnX: 180, furnTop: 445, furnW: 640, gapCm: 20 },
    bed: { defaultWidthCm: 152.4, furnX: 190, furnTop: 450, furnW: 620, visibleW: 592, visibleTop: 0, gapCm: 20 },
    console: { defaultWidthCm: 121.92, furnX: 260, furnTop: 490, furnW: 480, visibleW: 440, visibleTop: 34, gapCm: 20 },
    wall: { defaultWidthCm: 304.8, wallX: 100, wallBottom: 690, wallW: 800 },
  };
  const SG_MIN = 60;
  const SG_MAX = 600;
  const CM_PER_INCH = 2.54;

  class SizeGuideModal extends (BASE_MODAL || HTMLElement) {
    connectedCallback() {
      if (this.initialized) {
        this.connectObservers();
        return;
      }
      this.initialized = true;
      if (BASE_MODAL) super.connectedCallback();
      else {
        document.querySelectorAll(`[data-modal-open="${this.id}"]`).forEach(b => b.addEventListener("click", () => this.open()));
        this.querySelectorAll("[data-modal-close]").forEach(b => b.addEventListener("click", () => this.close()));
        this.addEventListener("click", e => { if (e.target === this) this.close(); });
      }

      const find = name => this.querySelector(`[data-sg-${name}]`);
      this.stage = find("stage");
      this.world = find("world");
      this.furnitureEl = find("furniture");
      this.wallEl = find("wall");
      this.artEl = find("art");
      this.artImg = find("art-img");
      this.captionEl = find("caption");
      this.widthInput = find("width");
      this.widthLabel = find("width-label");
      this.heightGroup = find("height-group");
      this.heightInput = find("height");
      this.heightLabel = find("height-label");
      this.heightSecondary = find("height-secondary");
      this.referenceEl = find("reference");
      this.widthHint = find("width-hint");
      this.widthSecondary = find("width-secondary");
      this.picker = find("furniture-picker");
      this.unitPicker = find("units");
      this.sizesEl = find("sizes");
      this.selectedEl = find("selected");
      this.secondaryEl = find("secondary");
      this.frameEl = find("frame");
      this.priceEl = find("price");
      this.applyBtn = find("apply");
      this.unavailableEl = find("unavailable");
      this.adviceEl = find("advice");
      this.suggestBtn = find("suggest");
      this.emptyEl = find("empty");
      this.outlineBtn = find("outline");
      this.variantPicker = window.theme.sectionRoot(this).querySelector("variant-picker");
      try {
        this.data = JSON.parse(this.querySelector("[data-size-guide-data]").textContent);
      } catch {
        this.data = { sizes: [], variants: [], i18n: {} };
      }
      this.data.sizes = (this.data.sizes || []).filter(s => Number.isFinite(s.w) && Number.isFinite(s.h) && s.w > 0 && s.h > 0);
      this.state = {
        scene: "sofa", unit: "in", wallHeightCm: 243.84, outline: !this.data.scaleImageAvailable, widthCm: SG_SCENES.sofa.defaultWidthCm,
        sizeValue: this.data.currentSize, frameValue: this.data.currentFrame,
        options: this.data.currentOptions || [],
      };
      this.widths = Object.fromEntries(Object.entries(SG_SCENES).map(([key, value]) => [key, value.defaultWidthCm]));

      this.picker.addEventListener("click", e => {
        const btn = e.target.closest("[data-sg-scene]");
        if (!btn || !SG_SCENES[btn.dataset.sgScene]) return;
        this.state.scene = btn.dataset.sgScene;
        this.state.widthCm = this.widths[this.state.scene];
        this.track("size_guide_furniture_changed");
        this.render();
      });
      this.unitPicker.addEventListener("click", e => {
        const btn = e.target.closest("[data-sg-unit]");
        if (!btn || !["cm", "in"].includes(btn.dataset.sgUnit)) return;
        this.state.unit = btn.dataset.sgUnit;
        this.track("size_guide_unit_changed");
        this.render();
      });
      this.widthInput.addEventListener("change", () => this.setWidth(this.widthInput.value));
      this.heightInput.addEventListener("change", () => this.setHeight(this.heightInput.value));
      this.querySelectorAll("[data-sg-step]").forEach(b => b.addEventListener("click", () => {
        const factor = this.state.unit === "in" ? CM_PER_INCH : 1;
        const step = this.state.unit === "in" ? 2 : 5;
        this.setWidth(this.state.widthCm / factor + Number(b.dataset.sgStep) * step);
      }));
      this.sizesEl.addEventListener("click", e => {
        const btn = e.target.closest("[data-sg-size]");
        if (!btn || btn.disabled || !this.variantForSize(btn.dataset.sgSize)?.available) return;
        this.state.sizeValue = btn.dataset.sgSize;
        this.track("size_guide_size_changed");
        this.render();
      });
      this.suggestBtn.addEventListener("click", () => {
        const suggestion = this.suggestedSize();
        if (!suggestion) return;
        this.state.sizeValue = suggestion.value;
        this.track("size_guide_suggestion_previewed");
        this.render();
      });
      this.outlineBtn?.addEventListener("click", () => {
        this.state.outline = !this.state.outline;
        this.render();
      });
      this.applyBtn.addEventListener("click", () => this.applySize());
      this.onVariant = e => {
        if (e.detail?.source && !window.theme.sameSection(e.detail.source, this)) return;
        if (e.detail?.source === this.variantPicker) this.syncFromPicker();
        else if (e.detail?.variant && this.data.variants.some(v => v.id === e.detail.variant.id)) {
          this.state.options = [...e.detail.variant.options];
          this.state.sizeValue = this.state.options[this.data.sizeIndex];
          this.state.frameValue = this.state.options[this.data.frameIndex] || "";
        } else return;
        if (!this.classList.contains("hidden")) this.render();
      };
      this.onEscape = e => {
        if (!BASE_MODAL && e.key === "Escape" && !this.classList.contains("hidden")) this.close();
      };
      if ("ResizeObserver" in window) this.observer = new ResizeObserver(() => this.fitStage());
      this.connectObservers();
    }

    connectObservers() {
      window.addEventListener("variant:change", this.onVariant);
      document.addEventListener("keydown", this.onEscape);
      this.observer?.observe(this.stage);
    }

    disconnectedCallback() {
      window.removeEventListener("variant:change", this.onVariant);
      document.removeEventListener("keydown", this.onEscape);
      this.observer?.disconnect();
      if (!this.classList.contains("hidden")) this.close();
    }

    syncFromPicker() {
      if (!this.variantPicker?.state || !this.variantPicker.optionNames) return;
      this.state.options = this.variantPicker.optionNames.map(name => this.variantPicker.state[name]);
      this.state.sizeValue = this.state.options[this.data.sizeIndex];
      this.state.frameValue = this.state.options[this.data.frameIndex] || "";
    }

    open() {
      this.syncFromPicker();
      if (!this.classList.contains("hidden")) {
        this.render();
        return;
      }
      if (BASE_MODAL) super.open();
      else {
        this.classList.remove("hidden");
        this.classList.add("flex");
        window.theme.lockScroll(true);
        window.theme.trapFocus(this, true);
      }
      if (this.data.scaleImageAvailable && this.data.artSrc && !this.artImg.getAttribute("src")) this.artImg.src = this.data.artSrc;
      this.render();
      this.track("size_guide_open");
    }

    close() {
      if (this.classList.contains("hidden")) return;
      if (BASE_MODAL) super.close();
      else {
        this.classList.add("hidden");
        this.classList.remove("flex");
        window.theme.lockScroll(false);
        window.theme.trapFocus(this, false);
      }
      this.track("size_guide_close");
    }

    track(event) {
      window.dataLayer?.push({
        event, variantId: this.variantForSize(this.state.sizeValue)?.id,
        furniture: this.state.scene, furnitureWidthCm: this.state.widthCm,
        artwork: this.state.sizeValue, unit: this.state.unit,
      });
    }

    text(key, values = {}) {
      return (this.data.i18n[key] || "").replace(/__([A-Z_]+)__/g, (match, name) => values[name.toLowerCase()] ?? match);
    }

    number(value, digits = 1) {
      return new Intl.NumberFormat(this.data.locale || "en", { maximumFractionDigits: digits }).format(value);
    }

    dimensions(size, unit = this.state.unit) {
      if (!size) return "";
      const factor = unit === "in" ? CM_PER_INCH : 1;
      return `${this.number(size.w / factor)} × ${this.number(size.h / factor)} ${unit}`;
    }

    setWidth(value) {
      const n = Number(value);
      if (String(value).trim() && Number.isFinite(n)) {
        const cm = this.state.unit === "in" ? n * CM_PER_INCH : n;
        this.state.widthCm = Math.min(SG_MAX, Math.max(SG_MIN, Number(cm.toFixed(4))));
        this.widths[this.state.scene] = this.state.widthCm;
        this.track("size_guide_furniture_width_changed");
      }
      this.render();
    }

    setHeight(value) {
      const n = Number(value);
      if (String(value).trim() && Number.isFinite(n)) {
        const cm = this.state.unit === "in" ? n * CM_PER_INCH : n;
        this.state.wallHeightCm = Math.min(SG_MAX, Math.max(SG_MIN, Number(cm.toFixed(4))));
      }
      this.render();
    }

    variantForSize(value) {
      const rolled = this.variantPicker?.rolledOnlyVariant(value);
      if (rolled?.available) return this.data.variants.find(v => v.id === rolled.id);
      return this.data.variants.find(v => v.options[this.data.sizeIndex] === value &&
        v.options.every((option, i) => i === this.data.sizeIndex || option === this.state.options[i]));
    }

    suggestedSize() {
      if (this.state.scene === "wall") return null;
      return this.data.sizes.filter(s => this.variantForSize(s.value)?.available &&
        s.w / this.state.widthCm >= 0.6 && s.w / this.state.widthCm <= 0.75)
        .sort((a, b) => Math.abs(a.w / this.state.widthCm - 0.675) - Math.abs(b.w / this.state.widthCm - 0.675))[0] || null;
    }

    renderSizePills() {
      const focused = this.sizesEl.contains(document.activeElement) ? document.activeElement.dataset.sgSize : null;
      const suggestion = this.suggestedSize();
      const buttons = this.data.sizes.map(size => {
        const variant = this.variantForSize(size.value);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.sgSize = size.value;
        btn.className = "sg-pill sg-size-pill";
        btn.setAttribute("aria-pressed", String(size.value === this.state.sizeValue));
        btn.disabled = !variant?.available;
        if (btn.disabled) btn.setAttribute("data-soldout", "");
        const label = document.createElement("span");
        label.textContent = this.dimensions(size);
        const secondary = document.createElement("span");
        secondary.dataset.sgSizeSecondary = "";
        secondary.className = "font-sans text-[13px] text-neutral-500";
        secondary.textContent = this.dimensions(size, this.state.unit === "cm" ? "in" : "cm");
        const price = document.createElement("span");
        price.className = variant ? "sg-size-price money" : "sg-size-price";
        if (variant && window.theme.displayCurrency) price.innerHTML = window.theme.formatMoney(variant.price);
        else price.textContent = variant?.priceLabel || this.text("unavailableShort");
        btn.append(label, secondary, price);
        if (btn.disabled || suggestion?.value === size.value) {
          const note = document.createElement("span");
          note.className = "sg-size-note";
          note.textContent = this.text(btn.disabled ? "unavailableShort" : "suggested");
          btn.append(note);
        }
        return btn;
      });
      this.sizesEl.replaceChildren(...buttons);
      if (focused) buttons.find(b => b.dataset.sgSize === focused && !b.disabled)?.focus({ preventScroll: true });
    }

    fitStage() {
      const width = this.stage.clientWidth;
      const height = this.stage.clientHeight;
      if (!width || !height) return;
      const scale = Math.min(width / 1000, height / 700) * (this.camZoom || 1);
      this.world.style.transform = `translate(${width / 2}px, ${height}px) scale(${scale}) translate(-500px, -${this.camBottom || 700}px)`;
    }

    render() {
      const factor = this.state.unit === "in" ? CM_PER_INCH : 1;
      const digits = this.state.unit === "in" ? 1 : 2;
      this.widthInput.value = String(Number((this.state.widthCm / factor).toFixed(digits)));
      this.widthInput.min = String(Number((SG_MIN / factor).toFixed(digits)));
      this.widthInput.max = String(Number((SG_MAX / factor).toFixed(digits)));
      this.widthInput.step = this.state.unit === "in" ? "0.1" : "0.01";
      this.heightGroup.hidden = this.state.scene !== "wall";
      this.heightInput.value = String(Number((this.state.wallHeightCm / factor).toFixed(digits)));
      for (const prop of ["min", "max", "step"]) this.heightInput[prop] = this.widthInput[prop];
      this.heightLabel.textContent = `${this.text("wallHeight")} · ${this.state.unit}`;
      this.heightSecondary.textContent = `≈ ${this.number(this.state.wallHeightCm / (this.state.unit === "cm" ? CM_PER_INCH : 1))} ${this.state.unit === "cm" ? "in" : "cm"}`;
      this.referenceEl.textContent = this.text(`${this.state.scene}Reference`);
      this.widthLabel.textContent = `${this.text(this.state.scene === "wall" ? "wallWidth" : "width")} · ${this.state.unit}`;
      this.widthHint.textContent = this.text("widthRange", { min: this.number(SG_MIN / factor), max: this.number(SG_MAX / factor), unit: this.state.unit });
      const secondaryUnit = this.state.unit === "cm" ? "in" : "cm";
      this.widthSecondary.textContent = `≈ ${this.number(this.state.widthCm / (secondaryUnit === "in" ? CM_PER_INCH : 1))} ${secondaryUnit}`;
      this.querySelectorAll("[data-sg-step]").forEach(b => {
        b.disabled = Number(b.dataset.sgStep) < 0 ? this.state.widthCm <= SG_MIN : this.state.widthCm >= SG_MAX;
      });
      this.picker.querySelectorAll("[data-sg-scene]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sgScene === this.state.scene)));
      this.unitPicker.querySelectorAll("[data-sg-unit]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sgUnit === this.state.unit)));
      this.renderSizePills();

      const size = this.data.sizes.find(s => s.value === this.state.sizeValue);
      const variant = this.variantForSize(this.state.sizeValue);
      this.selectedEl.textContent = this.dimensions(size) || this.text("empty");
      this.secondaryEl.textContent = size ? this.dimensions(size, this.state.unit === "cm" ? "in" : "cm") : "";
      this.frameEl.textContent = variant?.options[this.data.frameIndex] || this.state.frameValue || "";
      this.querySelector('[data-sg-rolled-only]').hidden = !this.variantPicker?.rolledOnlyVariant(this.state.sizeValue);
      const price = document.createElement("span");
      price.className = "money";
      if (variant && window.theme.displayCurrency) price.innerHTML = window.theme.formatMoney(variant.price);
      else price.textContent = variant?.priceLabel || "";
      this.priceEl.replaceChildren(price);
      this.applyBtn.disabled = !size || !variant?.available;
      this.unavailableEl.classList.toggle("hidden", !!size && !!variant?.available);
      this.emptyEl.classList.toggle("hidden", this.data.sizes.length > 0);
      this.outlineBtn?.setAttribute("aria-pressed", String(this.state.outline));
      const suggestion = this.suggestedSize();
      const isWall = this.state.scene === "wall";
      this.adviceEl.textContent = isWall ? this.text("wallAdvice") : this.text("rule") + " " + this.text(suggestion ? "suggestionAdvice" : "noSuggestion");
      this.suggestBtn.hidden = !suggestion;
      this.suggestBtn.textContent = suggestion ? this.text("previewSuggestion", { size: this.dimensions(suggestion) }) : "";
      // New price nodes must join the same currency conversion as the PDP.
      // Recreate them from canonical labels so repeated renders never convert
      // an already-converted amount a second time.
      window.theme.reconvertPrices?.();
      if (!size) {
        this.artEl.hidden = true;
        this.captionEl.textContent = "";
        return;
      }
      this.renderScene(size);
    }

    renderScene(size) {
      const scene = SG_SCENES[this.state.scene];
      const isWall = this.state.scene === "wall";
      const pxPerCm = (isWall ? scene.wallW : (scene.visibleW || scene.furnW)) / this.state.widthCm;
      this.furnitureEl.hidden = isWall;
      this.wallEl.hidden = !isWall;
      const wallHeight = this.state.wallHeightCm * pxPerCm;
      const wallTop = scene.wallBottom - wallHeight;
      if (isWall) {
        Object.assign(this.wallEl.style, { left: `${scene.wallX}px`, top: `${wallTop}px`, width: `${scene.wallW}px`, height: `${wallHeight}px` });
      } else {
        if (this.furnitureEl.dataset.sgFurnitureScene !== this.state.scene) {
          this.furnitureEl.src = this.data.furniture[this.state.scene];
          this.furnitureEl.dataset.sgFurnitureScene = this.state.scene;
        }
        Object.assign(this.furnitureEl.style, { left: `${scene.furnX}px`, top: `${scene.furnTop}px`, width: `${scene.furnW}px`, height: "auto" });
      }
      const artW = size.w * pxPerCm;
      const artH = size.h * pxPerCm;
      const previewFrame = this.variantForSize(this.state.sizeValue)?.options[this.data.frameIndex] || this.state.frameValue;
      const material = window.theme.frameMaterial(previewFrame);
      const texture = material && this.data.textures[material.key];
      const border = material ? Math.max(1.5, artW * 0.0165) : 0;
      const outerW = artW + 2 * border;
      const outerH = artH + 2 * border;
      const artLeft = 500 - outerW / 2;
      const artTop = isWall ? (wallTop + scene.wallBottom) / 2 - outerH / 2 : scene.furnTop + (scene.visibleTop || 0) - scene.gapCm * pxPerCm - outerH;
      this.artEl.hidden = false;
      this.artImg.hidden = this.state.outline || !this.data.scaleImageAvailable;
      this.artEl.dataset.frame = material?.key || "none";
      Object.assign(this.artEl.style, {
        left: `${artLeft}px`, top: `${artTop}px`, width: `${artW}px`, height: `${artH}px`,
        borderWidth: `${border}px`, borderColor: material?.color || "transparent",
        borderImageSource: texture ? `url('${texture}')` : "none",
      });
      const left = Math.min(artLeft, isWall ? scene.wallX : scene.furnX);
      const right = Math.max(artLeft + outerW, isWall ? scene.wallX + scene.wallW : scene.furnX + scene.furnW);
      const top = Math.min(artTop, isWall ? wallTop : scene.furnTop);
      this.camBottom = Math.max(700, artTop + outerH);
      this.camZoom = Math.min(1, 980 / (right - left), 680 / (this.camBottom - top));
      const pct = Math.round(size.w / this.state.widthCm * 100);
      this.captionEl.textContent = this.text("caption", { percent: pct, furniture: this.text(this.state.scene) });
      if (outerW > (isWall ? scene.wallW : (scene.visibleW || scene.furnW))) this.captionEl.textContent += " · " + this.text("wider");
      if (isWall) {
        this.captionEl.textContent += " · " + this.text("wallDimensions", { dimensions: this.dimensions({ w: this.state.widthCm, h: this.state.wallHeightCm }) });
        if (outerH > wallHeight) this.captionEl.textContent += " · " + this.text("taller");
      }
      if (this.state.outline || !this.data.scaleImageAvailable) this.captionEl.textContent = this.text("outline") + " · " + this.captionEl.textContent;
      this.fitStage();
    }

    applySize() {
      if (!this.variantForSize(this.state.sizeValue)?.available || this.applyBtn.disabled) return;
      const button = [...(this.variantPicker?.querySelectorAll('[data-option-name="Size"]') || [])]
        .find(b => b.dataset.optionValue === this.state.sizeValue && !b.hasAttribute("data-soldout"));
      if (!button) return;
      button.click();
      this.track("size_guide_apply_size");
      this.close();
    }
  }
  customElements.define("size-guide-modal", SizeGuideModal);
}
