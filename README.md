# CANVASRA Shopify theme

Storefront: **https://canvasra.com/**. Native Shopify OS 2.0 Liquid theme,
Tailwind 4 and vanilla Web Components; no React. Products sell and check out
directly in Shopify — there is no separate commerce platform in front of it.

This repository is a clean starting point for the Canvasra storefront. It was
derived from an earlier storefront's theme and Product Studio toolchain, so some
internal identifiers still carry that origin (see [Store identity](#store-identity)).

## Start here

Read [AGENTS.md](AGENTS.md) and the
[Shopify/GitHub runbook](docs/SHOPIFY_GITHUB_WORKFLOW.md) before editing or deploying.
The live theme and `origin/main` synchronize in both directions. Local code
changes are not permission to publish. Preserve merchant-owned settings and JSON
templates, and fetch immediately before rebasing or pushing. Never force-push.

This repository is not yet connected to a store. [New store setup](docs/NEW_STORE_SETUP.md)
walks through the store, credentials, sync and content that still have to be created.

## Store identity

Nothing in this repository hardcodes a storefront host. `scripts/product-studio/store-identity.js`
is the single source of truth, reading from `.env` (copy `.env.example` first):

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_STORE` | Internal `*.myshopify.com` domain used for Admin API calls |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Custom-app client credentials grant |
| `SHOPIFY_STOREFRONT_HOST` | Public host, e.g. `canvasra.com`; reads and writes are refused if the shop does not match |
| `SHOPIFY_CURRENCY` | Expected shop currency, defaults to `USD` |

Product Studio, the price snapshot/apply scripts and the Codex ledger all validate
the shop returned by the Admin API against these values, so a stale credential can
never write into a different storefront.


## Development

Use pnpm; `pnpm-lock.yaml` is the single dependency lockfile.

```sh
pnpm install --frozen-lockfile
pnpm css                  # build committed assets/theme.css
pnpm css:watch            # rebuild while developing
pnpm dev                  # Shopify development preview; requires CLI authentication
pnpm check                # Shopify Theme Check
pnpm test                 # offline regression/contract tests
pnpm verify               # check + tests
pnpm preview:shopping     # synthetic cart/wishlist preview, localhost:4173
pnpm studio               # local product workflow web app, localhost:4310
```

`pnpm dev` retains the existing `--host 0.0.0.0` setting. Use an appropriate
firewall on shared hosts. The shopping preview does not modify store data;
`/cart?fixture=two&messages=1` and `/pages/wishlist?fixture=mixed` provide fixtures.

There are intentionally no unrestricted `push`/`pull` package shortcuts. Follow
the runbook, using explicit filenames and backups for live theme updates.

## Project map

Documentation: [current index](docs/README.md), [project status and validation limits](docs/PROJECT_STATUS.md), and [Product Studio](docs/PRODUCT_STUDIO.md).

| Path | Purpose |
| --- | --- |
| `layout/`, `sections/`, `snippets/` | Storefront Liquid and reusable components |
| `templates/`, `config/` | Merchant-owned page composition and theme settings |
| `locales/` | Customer-facing translations |
| `src/theme.css` | Tailwind source and component styling |
| `assets/theme.css` | Built CSS; commit alongside relevant source changes |
| `assets/` | Browser scripts, six frame textures, swatches and theme imagery |
| `scripts/` | Tests, preview tooling, administrative and legacy helpers |
| `docs/` | Current workflows and implementation records |
| `.shopify/` | Ignored local credentials/cache, backups, generated masters and operation manifests |

Never commit `.env` or cached Admin tokens. Keep original generated artwork and
publication backups: they are production provenance/recovery data, not trash.

## Current product system

- USD retail prices use [the versioned price table](docs/PRICE_TABLE.md), shared by Product Studio and existing-product repricing. Live references supply availability and delivery combinations, not retail amounts.

- Preserve each product's actual size ladder. New catalog reference ratios are
  **3:4, 2:3, 1:1, 4:3, 3:2 and 2:1**. There is no universal five-size ladder.
- `Size` values contain real dimensions; `Frame` distinguishes **Rolled Canvas**,
  **Stretched Canvas**, and **Oak / Black / Walnut / White / Gold / Silver Float Frame**.
  Legacy frame names remain supported for existing products.
- First available Oak is the default preview/selection. Explicit variant links
  retain their selection; products without available Oak use the normal fallback.
- Existing rolled-only sizes are labeled and selectable. Selecting one switches
  to the available rolled variant, updates price/previews/ATC and shows a notice.
  This does not create variants or certify thick-texture paintings as rollable.
- Current new-catalog sizes over 180 cm have only rolled variants. Heavy texture
  and exceptional shipping need production confirmation; do not infer suitability
  from an AI image or add rolled options merely to make a size selectable.
- Legacy catalog products use three images: complete artwork (`alt=master`), a crop
  of that artwork, and an empty room background (`alt=scene-room-v1`). The theme
  composites the artwork/frame into the room; gallery and lightbox stay in sync.
  Other secondary images remain ordinary gallery images.
- New Product Studio tasks create six media: master, a real detail crop, three
  4:5 finished room scenes and one 21:9 desktop scene. Scenes are generated with
  the selected float frame baked in (`baked-frames-v1`, alts
  `composed-framed-scene-*-v1`); historical products keep empty-room backgrounds
  or unframed scenes whose `custom.scene_layouts` coordinates drive frame-only
  overlays. Publishing requires the matching live profile marker — the theme
  emits both `composed-frames-v1` and `baked-frames-v1` — otherwise Studio
  retains a draft. Historical backgrounds and tasks retain their versions.
- Room views are styling visualizations. The separate size-guide
  visualizer uses real dimensions against furniture silhouettes (`assets/sg-*.svg`).
- Shopify prices and checkout remain **USD**. `assets/display-currency.js` renders
  local-currency estimates; it must not rewrite canonical variant prices.
- Collection membership follows Shopify collection rules. Current tags include
  `subject-*`, `style-*`, `mood-*`, `space-*`, `new-arrival`, `oversized-art` and
  `curated-set`. Do not invent best-seller tags or customer reviews.
- Vendor is product-specific; do not force artist metadata or replace existing values.

See [image rules](docs/PRODUCT_IMAGE_RULES.md) for details. The old product
creator and letter-size migration are legacy utilities, not the current SOP.

## Merchant setup and retained features

- Enable native Availability, Price and Frame filters in Search & Discovery.
  Orientation uses `custom.orientation` (Landscape / Portrait / Square); the
  dry-run-first `scripts/set-orientation.js` derives it from the master image.
  The storefront displays a generic filter until the orientation filter exists.
- Subject navigation uses `snippets/collection-subject-handles.liquid` and real
  collection URLs. Update handles, translations and menus together.
- Size guide: `custom.size_guide_enabled` (absent means enabled). Units convert
  display only. Applying a size updates the PDP picker, not the cart.
- Craftsmanship content: `custom.craftsmanship`, with product value overriding
  shop fallback, plus merchant-managed section blocks.
- Reviews are disabled by default. Enable only after verification and permission.
- Wishlist: select the wishlist page in theme settings; legacy handle fallback
  remains supported. Cart free-shipping threshold is configured in minor units.
- Typography: merchant-selected serif for headings; sans-serif for prose and
  shopping controls. Keep inputs at least 16px and rebuild CSS after style edits.

## Codex desktop product skill

Use `$canvasra-product` in Codex with this repository open. The repository skill at
`.agents/skills/canvasra-product/` guides generation, review and authorized Shopify
publication; `pnpm canvasra --help` exposes its local resumable task ledger.
See [current ledger scope and setup](docs/CODEX_PRODUCT_WORKFLOW.md). This ledger
retains the empty-background contract and does not implement Studio's composed
scene publication. Follow the user's authorized scope and the skill; product work
does not authorize theme deployment.

## Documentation

- [Safe synchronization/deployment](docs/SHOPIFY_GITHUB_WORKFLOW.md)
- [Script inventory](docs/SCRIPTS.md)
- [Product image and delivery rules](docs/PRODUCT_IMAGE_RULES.md)
- [Journal editorial guide](docs/JOURNAL_EDITORIAL_GUIDE.md)

Policy text the product page depends on:
[purchase and cancellation policy](docs/PURCHASE_POLICY_UPDATE.md).

Store-managed page text, menus and policies live in Shopify, not in these docs.
Update their actual content via a backed-up, narrow Admin operation when authorized.
