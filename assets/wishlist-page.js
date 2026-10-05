/**
 * Wishlist page: saved handles fetch product JSON directly. A small embedded
 * id→handle map migrates wishlists created by older theme versions. Cards
 * update live when a heart is un-toggled.
 */
(function () {
  const root = document.querySelector("[data-wishlist-page]");
  if (!root) return;

  const grid = root.querySelector("[data-wishlist-grid]");
  const empty = root.querySelector("[data-wishlist-empty]");
  const count = root.querySelector("[data-wishlist-page-count]");
  const loading = root.querySelector("[data-wishlist-loading]");
  const error = root.querySelector("[data-wishlist-error]");
  const retry = root.querySelector("[data-wishlist-retry]");
  const productsByHandle = new Map();
  let renderVersion = 0;
  const legacyHandleMap = JSON.parse(
    document.querySelector("[data-wishlist-handle-map]").textContent
  );
  const ASPECT_KEYS = [["34", 0.75], ["23", 0.6667], ["square", 1], ["43", 1.3333], ["32", 1.5], ["21", 2]];
  function aspectOf(product) {
    const media = product.media?.[0];
    const ratio = Number(media?.aspect_ratio || (media?.width && media?.height ? media.width / media.height : 0));
    if (!(ratio > 0)) return "portrait";
    let best = "portrait";
    let bestDiff = 99;
    for (const [key, value] of ASPECT_KEYS) {
      const diff = Math.abs(ratio - value);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = key;
      }
    }
    return best;
  }

  function card(product) {
    const frameIdx = product.options.findIndex((option) =>
      (typeof option === "string" ? option : option.name)?.toLowerCase() === "frame"
    );
    const previewVariant = product.variants.find(variant => variant.available &&
      window.theme.frameKey(variant.options[frameIdx]) === "oak")
      || product.variants.find(variant => variant.available) || product.variants[0];
    const frame = frameIdx >= 0 ? previewVariant.options[frameIdx] : "Rolled Canvas";
    const media = product.media?.[0];
    const exactAspect = Number(media?.aspect_ratio || (media?.width && media?.height ? media.width / media.height : 0));
    const art = product.images[0]
      ? window.theme.frameArtMarkup(product.images[0], frame, product.title, aspectOf(product), exactAspect)
      : "";
    const titleParts = product.title.split(" – ");
    const displayTitle = titleParts.shift();
    const titleDetail = titleParts.join(" – ");
    const safeUrl = window.theme.escapeHtml(product.url);
    const safeTitle = window.theme.escapeHtml(product.title);
    const price = window.theme.formatMoney(product.price);
    const compares = (product.variants || []).map(v => Number(v.compare_at_price)).filter(x => Number.isFinite(x) && x > 0);
    const compare = compares.length ? Math.min(...compares) : 0;
    const compareLabel = compare > product.price
      ? `<s class="mr-1 font-normal text-neutral-400">${window.theme.formatMoney(compare)}</s> `
      : "";
    const priceLabel = product.price_varies
      ? root.dataset.fromPrice.replace("__PRICE__", () => price)
      : price;
    const el = document.createElement("div");
    el.className = "group/card relative min-w-0 [overflow-wrap:anywhere]";
    el.dataset.wishlistCard = product.handle;
    el.innerHTML = `
      <div class="relative aspect-[4/5] w-full">
        <div class="frame-mount relative flex h-full w-full items-center justify-center overflow-hidden transition-transform duration-500 group-hover/card:scale-[1.02]" style="background:#eef0ec">
          ${art}
        </div>
        <a href="${safeUrl}" aria-label="${safeTitle}" class="absolute inset-0 z-[1]"></a>
        <button type="button" data-wishlist-toggle="${window.theme.escapeHtml(product.handle)}" data-product-id="${product.id}" aria-pressed="true" aria-label="${window.theme.escapeHtml(root.dataset.removeText)}: ${safeTitle}"
          class="absolute right-3 top-3 z-[2] flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black backdrop-blur-xs transition-colors hover:bg-white">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4 fill-black" aria-hidden="true">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
          </svg>
        </button>
      </div>
      <div class="mt-4 space-y-1">
        <a href="${safeUrl}" class="block font-serif text-[19px] leading-[1.3] text-black">${window.theme.escapeHtml(displayTitle)}</a>
        ${titleDetail ? `<p class="font-sans text-[14px] leading-[1.5] text-neutral-600">${window.theme.escapeHtml(titleDetail)}</p>` : ""}
        <p class="font-sans text-[16px] font-medium leading-[1.5] text-black">${compareLabel}${priceLabel}</p>
      </div>`;
    return el;
  }

  function messageCard(key, kind) {
    const el = document.createElement("div");
    el.dataset.wishlistCard = key;
    el.className = "min-w-0 border border-neutral-200 p-4 font-sans text-[14px] [overflow-wrap:anywhere]";
    const message = document.createElement("p");
    message.textContent = kind === "error" ? root.dataset.errorText : root.dataset.unavailableText;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.wishlistToggle = key;
    remove.className = "mt-4 min-h-11 text-left underline underline-offset-4";
    remove.textContent = root.dataset.removeText;
    remove.setAttribute("aria-label", root.dataset.removeText);
    remove.setAttribute("aria-pressed", "true");
    el.append(message, remove);
    return el;
  }

  async function loadProduct(key) {
    if (/^\d+$/.test(key)) return { key, kind: "unavailable" };
    if (productsByHandle.has(key)) return { key, product: productsByHandle.get(key) };
    try {
      const rootPath = `${window.theme.routes.root || "/"}`.replace(/\/?$/, "/");
      const response = await fetch(`${rootPath}products/${encodeURIComponent(key)}.js`);
      if (response.status === 404 || response.status === 410) return { key, kind: "unavailable" };
      if (!response.ok) throw new Error("Product could not be loaded");
      const product = await response.json();
      if (!product || typeof product.handle !== "string" || !product.handle
        || typeof product.title !== "string" || typeof product.url !== "string"
        || !Number.isFinite(product.price) || !Array.isArray(product.variants)
        || !Array.isArray(product.variants[0]?.options) || !Array.isArray(product.options)
        || !product.options.every((option) => typeof option === "string" || typeof option?.name === "string")
        || !Array.isArray(product.images) || !product.images.every((url) => typeof url === "string")) {
        throw new Error("Invalid product response");
      }
      productsByHandle.set(key, product);
      return { key, product };
    } catch {
      return { key, kind: "error" };
    }
  }

  async function render() {
    const version = ++renderVersion;
    const saved = window.wishlist.items();
    // Keep unknown legacy IDs visible and removable instead of discarding them.
    const keys = [...new Set(saved.map((key) => legacyHandleMap[key] || key))];
    if (keys.join("\n") !== saved.join("\n")) {
      window.wishlist.replace(keys);
      return; // The synchronous change event starts the normalized render.
    }
    count.textContent = keys.length || "";
    empty.classList.toggle("hidden", keys.length > 0);
    loading.hidden = keys.length === 0;
    error.hidden = true;
    retry.hidden = true;
    root.setAttribute("aria-busy", String(keys.length > 0));
    const results = await Promise.all(keys.map(loadProduct));
    if (version !== renderVersion) return;
    const focused = document.activeElement?.closest("[data-wishlist-card]");
    const focusedKey = focused?.dataset.wishlistCard;
    const previousIndex = [...grid.children].indexOf(focused);
    grid.replaceChildren(...results.map(({ key, product, kind }) => {
      const el = product ? card(product) : messageCard(key, kind);
      // The saved handle can differ from the canonical handle after a redirect.
      el.dataset.wishlistCard = key;
      el.querySelector("[data-wishlist-toggle]").dataset.wishlistToggle = key;
      return el;
    }));
    const failed = results.some((result) => result.kind === "error");
    loading.hidden = true;
    error.hidden = !failed;
    retry.hidden = !failed;
    root.setAttribute("aria-busy", "false");
    window.theme.reconvertPrices?.();
    if (focusedKey) {
      const cards = [...grid.children];
      const next = cards.find((el) => el.dataset.wishlistCard === focusedKey)
        || cards[Math.min(previousIndex, cards.length - 1)];
      (next?.querySelector("[data-wishlist-toggle]") || root.querySelector("[data-wishlist-heading]"))
        ?.focus({ preventScroll: true });
    }
  }

  window.addEventListener("wishlist:change", () => { void render(); });
  retry.addEventListener("click", () => { void render(); });
  window.addEventListener("storage", (event) => {
    if (event.key === "makeready-wishlist" || event.key === null) {
      window.wishlist.sync();
      void render();
    }
  });

  void render();
})();
