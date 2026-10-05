if (!customElements.get("variant-picker")) {
/**
 * Variant picker: size list + frame swatches drive the real variant form.
 * On every change it finds the matching variant, then:
 *  - updates the hidden variant id input, ATC availability, URL (?variant=)
 *  - recomputes the per-size prices (size × current frame)
 *  - broadcasts "variant:change" so frame previews / price displays / the
 *    sticky bar update themselves
 */
class VariantPicker extends HTMLElement {
  connectedCallback() {
    this.variants = JSON.parse(this.querySelector("[data-variants]").textContent);
    this.optionNames = JSON.parse(this.querySelector("[data-option-names]").textContent);
    this.idInput = this.querySelector("[data-variant-id-input]");
    this.atc = this.querySelector("[data-atc]");
    this.form = this.querySelector("form");

    this.state = {};
    // every option defaults to the current variant's value — covers implicit
    // options ("Default Title") that have no picker buttons
    const current = JSON.parse(this.querySelector("[data-current-variant]").textContent);
    this.optionNames.forEach((name, i) => {
      this.state[name] = current.options[i];
    });
    this.querySelectorAll("[data-option-button][aria-pressed='true']").forEach((b) => {
      this.state[this.canonicalName(b.dataset.optionName)] = b.dataset.optionValue;
    });

    this.querySelectorAll("[data-option-button]").forEach((b) =>
      b.addEventListener("click", () =>
        this.select(this.canonicalName(b.dataset.optionName), b.dataset.optionValue)
      )
    );

    // desktop size dropdown: collapse after picking, on outside click or Esc
    this.sizeDropdown = this.querySelector("[data-size-dropdown]");
    if (this.sizeDropdown) {
      this.sizeDropdown.addEventListener("click", (e) => {
        if (e.target.closest("[data-option-button]")) this.sizeDropdown.removeAttribute("open");
      });
      this.sizeDropdown.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.sizeDropdown.removeAttribute("open");
      });
      document.addEventListener("click", (e) => {
        if (this.sizeDropdown.hasAttribute("open") && !this.sizeDropdown.contains(e.target)) {
          this.sizeDropdown.removeAttribute("open");
        }
      });
    }

    this.querySelectorAll("[data-qty-change]").forEach((b) =>
      b.addEventListener("click", () => {
        const input = this.querySelector("[data-qty-input]");
        input.value = Math.max(1, Number(input.value) + Number(b.dataset.qtyChange));
      })
    );

    // qty input: digits only, min 1
    const qtyInput = this.querySelector("[data-qty-input]");
    qtyInput?.addEventListener("input", () => {
      qtyInput.value = qtyInput.value.replace(/\D/g, "").slice(0, 2);
    });
    qtyInput?.addEventListener("change", () => {
      if (!qtyInput.value || Number(qtyInput.value) < 1) qtyInput.value = 1;
    });

    this.update();
  }

  select(name, value) {
    name = this.canonicalName(name);
    this.state[name] = value;
    if (name.toLowerCase() === 'size') {
      const rolled = this.rolledOnlyVariant(value);
      if (rolled?.available) this.state[this.canonicalName('Frame')] = rolled.options[this.frameIdx];
    }
    this.update(name);
  }

  /** Resolve a picker button name ("Size"/"Frame") to the product's actual
   *  option name, case-insensitively; falls back to the given name. */
  canonicalName(name) {
    return this.optionNames.find((n) => n.toLowerCase() === String(name).toLowerCase()) ?? name;
  }

  get frameValue() {
    return this.state[this.canonicalName("Frame")];
  }

  rolledOnlyVariant(size) {
    if (this.sizeIdx < 0 || this.frameIdx < 0) return null;
    const variants = this.variants.filter(v => v.options[this.sizeIdx] === size);
    if (!variants.length || variants.some(v => v.options[this.frameIdx]?.toLowerCase() !== 'rolled canvas')) return null;
    return variants.find(v => this.optionNames.every((_, i) =>
      i === this.sizeIdx || i === this.frameIdx || v.options[i] === this.state[this.optionNames[i]]
    )) ?? null;
  }

  sizeRowVariant(size) {
    const rolled = this.rolledOnlyVariant(size);
    return (rolled?.available ? rolled : null) ?? this.variants.find(v =>
      this.optionNames.every((name, i) => v.options[i] === (i === this.sizeIdx ? size : this.state[name]))
    );
  }

  get selectedVariant() {
    return this.variants.find((v) =>
      this.optionNames.every((name, i) => v.options[i] === this.state[name])
    );
  }

  update(selectedOption = null) {
    const v = this.selectedVariant;

    // pressed states (styling handled by aria-pressed:* variants in markup)
    this.querySelectorAll("[data-option-button]").forEach((b) => {
      b.setAttribute(
        "aria-pressed",
        String(this.state[this.canonicalName(b.dataset.optionName)] === b.dataset.optionValue)
      );
    });

    // sold-out visuals: frame swatches = any size available; size rows = at current frame
    this.querySelectorAll('[data-option-name="Frame"]').forEach((b) => {
      const rolledSize = this.rolledOnlyVariant(this.state[this.canonicalName('Size')]);
      const avail = this.variants.some(
        (x) => x.options[this.frameIdx] === b.dataset.optionValue && x.available &&
          (!rolledSize || x.options[this.sizeIdx] === rolledSize.options[this.sizeIdx])
      );
      b.disabled = !!rolledSize && !avail;
      this.markAvailability(b, avail, true);
    });
    this.querySelectorAll('[data-option-name="Size"]').forEach((b) => {
      const row = this.sizeRowVariant(b.dataset.optionValue);
      this.markAvailability(b, !!row?.available, false);
      b.querySelector('[data-rolled-only-label]')?.classList.toggle('hidden', !this.rolledOnlyVariant(b.dataset.optionValue));
    });

    // per-size prices at the current frame
    const rolledChoice = this.querySelector('[data-rolled-choice]');
    if (rolledChoice) {
      const rolled = this.variants.find(x => this.optionNames.every((name, i) =>
        x.options[i] === (i === this.frameIdx ? 'Rolled Canvas' : this.state[name])
      ));
      const selected = this.frameValue === 'Rolled Canvas';
      rolledChoice.disabled = !rolled?.available;
      this.markAvailability(rolledChoice, !!rolled?.available, false);
      rolledChoice.querySelector('[data-rolled-price]').innerHTML = rolled ? window.theme.formatMoney(rolled.price) : 'Unavailable';
      rolledChoice.querySelector('[data-rolled-title]').textContent = selected ? 'Rolled canvas selected' : 'Prefer rolled canvas?';
      rolledChoice.querySelector('[data-rolled-selected]').textContent = selected ? 'Selected' : '';
    }
    this.querySelectorAll("[data-size-price]").forEach((el) => {
      const row = this.sizeRowVariant(el.dataset.sizePrice);
      el.innerHTML = row ? window.theme.formatMoney(row.price) : '';
    });

    const rolledSize = this.rolledOnlyVariant(this.state[this.canonicalName('Size')]);
    this.querySelectorAll('[data-rolled-only-notice]').forEach(el => {
      const show = !!rolledSize;
      el.classList.toggle('hidden', !show);
      el.textContent = show ? this.dataset.rolledOnlyNotice : '';
    });

    this.querySelectorAll("[data-frame-name], [data-row-frame-name]").forEach((el) => {
      el.textContent = this.frameValue ?? "";
    });

    if (!v) {
      window.theme.sectionRoot(this).querySelectorAll('[data-sale-banner]').forEach(el => { el.hidden = true; });
      this.idInput.value = "";
      this.setAtc(false, this.dataset.unavailableText);
      this.querySelectorAll("[data-atc-price]").forEach((el) => {
        el.textContent = "";
      });
    } else {
      this.idInput.value = v.id;
      this.setAtc(v.available, v.available ? this.dataset.addText : this.dataset.soldOutText);
      const url = new URL(window.location.href);
      url.searchParams.set("variant", v.id);
      window.history.replaceState({}, "", url);

      // section-level displays that follow the variant
      const root = window.theme.sectionRoot(this);
      const sale = v.compare_at_price && v.compare_at_price > v.price;
      root.querySelectorAll('[data-sale-banner]').forEach(el => {
        el.hidden = !sale;
        const percent = el.querySelector('[data-sale-banner-percent]');
        if (percent) percent.textContent = sale ? Math.round((v.compare_at_price - v.price) / v.compare_at_price * 100) : '';
      });
      root.querySelectorAll("[data-main-price]").forEach((el) => {
        el.innerHTML = window.theme.formatMoney(v.price);
        el.classList.toggle("text-black", !!sale);
      });
      root.querySelectorAll("[data-main-compare]").forEach((el) => {
        el.innerHTML = sale ? window.theme.formatMoney(v.compare_at_price) : "";
        el.classList.toggle("hidden", !sale);
      });
      root.querySelectorAll("[data-main-save]").forEach((el) => {
        el.textContent = sale
          ? "-" + Math.round(((v.compare_at_price - v.price) / v.compare_at_price) * 100) + "%"
          : "";
        el.classList.toggle("hidden", !sale);
      });
      this.querySelectorAll("[data-atc-price]").forEach((el) => {
        el.innerHTML = "· " + window.theme.formatMoney(v.price);
      });
      root.querySelectorAll("[data-framed-note]").forEach((el) => {
        el.classList.toggle("hidden", ["Rolled Canvas", "Stretched Canvas", "No frame"].includes(this.frameValue));
      });
      const sizeBtn = this.querySelector('[data-option-name="Size"][aria-pressed="true"]');
      if (sizeBtn) {
        // Display labels include inches; variant values remain canonical cm.
        const sizeLabel = sizeBtn.dataset.sizeLabel || sizeBtn.dataset.optionValue;
        root.querySelectorAll("[data-size-line]").forEach((el) => {
          el.textContent = sizeLabel;
        });
        this.querySelectorAll("[data-row-size-dims]").forEach((el) => {
          el.textContent = sizeLabel;
        });
      }
      const frameBtn = this.querySelector('[data-option-name="Frame"][aria-pressed="true"]');
      const frameImg = frameBtn?.querySelector("img");
      this.querySelectorAll("[data-row-frame-swatch]").forEach((el) => {
        if (frameImg) {
          el.src = frameImg.src;
          el.classList.remove("hidden");
        } else {
          el.classList.add("hidden");
        }
      });
    }

    window.dispatchEvent(
      new CustomEvent("variant:change", {
        detail: { variant: v, frame: this.frameValue, source: this, selectedOption },
      })
    );
    window.theme.reconvertPrices?.();
  }

  get sizeIdx() {
    return this.optionNames.findIndex((n) => n.toLowerCase() === "size");
  }

  get frameIdx() {
    return this.optionNames.findIndex((n) => n.toLowerCase() === "frame");
  }

  markAvailability(btn, available, withLine) {
    btn.classList.toggle("option-soldout", !available);
    btn.classList.toggle("option-soldout-line", !available && withLine);
    if (available) btn.removeAttribute("data-soldout");
    else btn.setAttribute("data-soldout", "");
  }

  setAtc(enabled, text) {
    this.atc.disabled = !enabled;
    this.atc.querySelector("[data-atc-text]").textContent = text;
    this.atc.classList.toggle("opacity-30", !enabled);
    this.atc.classList.toggle("cursor-not-allowed", !enabled);
  }
}

customElements.define("variant-picker", VariantPicker);
}
