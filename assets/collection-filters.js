if (!customElements.get("collection-filters")) {
/**
 * Collection page filtering: AJAX updates via the Section Rendering API —
 * changing filters, sorting or paginating re-renders the chips, results
 * grid, sidebar and drawer form in place and pushes the URL, with a
 * dimmed grid while loading and a full page load as fallback. Pagination
 * additionally scrolls to the top of the new results (filters scroll
 * smoothly, the pager jumps) so a tap at the footer never leaves the
 * shopper at the bottom of the next page. The mobile drawer (right
 * slide-in) shares the same form markup as the desktop sidebar; Esc /
 * scrim / Done close it.
 */
const RERENDER_KEYS = ["filter-btn", "chips", "count", "sort", "results", "sidebar", "drawer-form"];

class CollectionFilters extends HTMLElement {
  connectedCallback() {
    this.sectionId = this.dataset.sectionId;
    this.collectionUrl = this.dataset.collectionUrl;
    if (this.dataset.subjectRedirectUrl) {
      const target = new URL(this.dataset.subjectRedirectUrl, window.location.href);
      target.search = window.location.search;
      target.searchParams.delete("page");
      window.location.replace(target.href);
      return;
    }
    this.controller = null;
    this.drawer = this.querySelector("[data-filters-drawer]");
    this.panel = this.querySelector("[data-filters-panel]");
    this.scrim = this.querySelector("[data-filters-scrim]");

    this.addEventListener("change", (e) => {
      if (e.target.matches("[data-sort-select]")) {
        this.submit(this.querySelector("[data-filter-form]"));
        return;
      }
      const form = e.target.closest("[data-filter-form]");
      if (form && e.target.type !== "number") {
        this.selectOrientation(e.target, form);
        this.submit(form);
      }
    });

    this.addEventListener("submit", (e) => {
      if (e.target.closest("[data-filter-form]")) {
        e.preventDefault();
        this.submit(e.target.closest("[data-filter-form]"));
      }
    });

    this.addEventListener("click", (e) => {
      if (e.target.closest("[data-filters-open]")) {
        this.openDrawer();
        return;
      }
      if (e.target.closest("[data-filters-close]") || e.target.closest("[data-filters-done]")) {
        this.closeDrawer();
        return;
      }
      if (e.target.closest("[data-subject-clear]")) {
        const form = this.querySelector("[data-filter-form]");
        this.submit(form, this.dataset.subjectAllUrl);
        return;
      }
      const link = e.target.closest("a[data-ajax-link]");
      if (link) {
        e.preventDefault();
        // pagination: jump straight to the first row of the new page instead of leaving
        // the viewport at the footer where the pager was tapped
        this.render(link.href, true, "auto");
      }
    });

    this.scrim?.addEventListener("click", () => this.closeDrawer());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.drawer && !this.drawer.classList.contains("hidden")) {
        this.closeDrawer();
      }
    });

    window.addEventListener("popstate", () => this.render(window.location.href, false, false));
  }

  openDrawer() {
    if (!this.drawer) return;
    this.drawer.classList.remove("hidden");
    this.drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      this.scrim.classList.remove("opacity-0");
      this.panel.classList.remove("translate-x-full");
    });
    window.theme.lockScroll(true);
    window.theme.trapFocus(this.panel, true);
  }

  closeDrawer() {
    if (!this.drawer || this.drawer.classList.contains("hidden")) return;
    this.scrim.classList.add("opacity-0");
    this.panel.classList.add("translate-x-full");
    window.theme.lockScroll(false);
    window.theme.trapFocus(this.panel, false);
    setTimeout(() => {
      this.drawer.classList.add("hidden");
      this.drawer.setAttribute("aria-hidden", "true");
    }, 300);
  }

  selectOrientation(input, form) {
    if (!input.checked || !input.closest("[data-orientation-filter]")) return;
    for (const other of form.querySelectorAll("[data-orientation-filter] input")) {
      if (other !== input && other.name === input.name) other.checked = false;
    }
  }

  submit(form, subjectUrl) {
    const params = new URLSearchParams();
    if (form) {
      for (const el of form.elements) {
        if (!el.name || el.disabled || el.name === "sort_by" || el.name === "subject") continue;
        if (el.type === "checkbox" && !el.checked) continue;
        if (el.value === "") continue;
        params.append(el.name, el.value);
      }
    }
    if (this.querySelector("[data-sort-select]")?.value) {
      params.set("sort_by", this.querySelector("[data-sort-select]").value);
    }
    const qs = params.toString();
    const baseUrl = subjectUrl || form?.querySelector("[data-subject-filter]:checked")?.value || this.collectionUrl;
    this.render(`${baseUrl}${qs ? `?${qs}` : ""}`, true, true);
  }

  render(url, push, scroll) {
    const target = new URL(url, window.location.href);
    if (target.pathname !== window.location.pathname) {
      window.location.assign(target.href);
      return;
    }
    if (this.controller) this.controller.abort();
    this.controller = new AbortController();
    const results = this.querySelector('[data-filters-rerender="results"]');
    results?.classList.add("opacity-40");
    const sep = url.includes("?") ? "&" : "?";

    fetch(`${url}${sep}section_id=${this.sectionId}`, { signal: this.controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Collection request failed: ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const fresh = new DOMParser().parseFromString(text, "text/html").querySelector("collection-filters");
        if (!fresh) throw new Error("Collection section missing");
        RERENDER_KEYS.forEach((key) => {
          const next = fresh.querySelector(`[data-filters-rerender="${key}"]`);
          const current = this.querySelector(`[data-filters-rerender="${key}"]`);
          if (next && current) current.replaceWith(next);
        });
        window.wishlist?.sync?.();
        window.theme.reconvertPrices?.();
        if (push) window.history.pushState({}, "", url);
        const updatedResults = this.querySelector('[data-filters-rerender="results"]');
        // scroll accepts a ScrollIntoViewOptions behaviour or true for the default smooth
        // scroll; the results container carries a scroll margin so the fixed mobile
        // header never covers the first row.
        if (scroll) updatedResults?.scrollIntoView({ behavior: scroll === true ? "smooth" : scroll, block: "start" });
        updatedResults?.classList.remove("opacity-40");
      })
      .catch((err) => {
        if (err.name !== "AbortError") window.location.href = url;
      });
  }
}

customElements.define("collection-filters", CollectionFilters);
}
