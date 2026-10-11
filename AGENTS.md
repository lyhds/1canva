# Project Instructions for Agents

These instructions apply to the entire repository. Read
`docs/SHOPIFY_GITHUB_WORKFLOW.md` before changing the theme, using the Shopify
Admin API, committing, or pushing.

## Project entry points

- Public storefront: `https://canvasra.com/`. Use this domain or relative
  paths for customer-facing links. Keep the internal Shopify domain for
  authenticated API/CLI connections; never replace credential configuration
  as part of a storefront-link cleanup.
- Never hardcode a storefront host in code. `scripts/product-studio/store-identity.js`
  is the single source of truth; it reads `SHOPIFY_STOREFRONT_HOST` and
  `SHOPIFY_CURRENCY` from the ignored `.env` (template in `.env.example`). Any
  script that reads or writes shop data must validate the Admin API shop against
  those values before acting.
- Use pnpm/pnpx, not npm/npx. `pnpm-lock.yaml` is the single dependency lockfile;
  preserve `pnpm-workspace.yaml` and the package-manager version in `package.json`.
- Read `README.md` for the current architecture and commands.
- Before product, image, size, frame, or delivery changes, read
  `docs/PRODUCT_IMAGE_RULES.md`. `docs/PROJECT_STATUS.md` records what this
  checkout has and has not verified; it is never a source of live product
  counts, IDs or current policy.
- Before running administrative scripts, read `docs/SCRIPTS.md`.

## Product and storefront invariants

- Preserve existing product sizes and the six ratio draft templates. New
  catalog reference ratios are 3:4, 2:3, 1:1, 4:3, 3:2 and 2:1; do not impose
  the retired five-size ladder on existing products.
- Distinguish Rolled Canvas, Stretched Canvas and six Float Frame finishes
  (Oak, Black, Walnut, White, Gold, Silver). Defaults prefer available Oak;
  explicit variant links retain their selection. Keep legacy frame aliases
  compatible with stored carts, wishlists and older products.
- New catalog products use three Shopify-hosted images: the complete artwork
  (`master`), a detail cropped from that artwork, and an empty room background
  (`scene-room-v1`) with separate artwork/frame overlays. Keep main images,
  room scenes, thumbnails and lightbox previews synchronized.
- Rolled-only size selection may switch delivery only to an existing available
  rolled variant, with a visible notice and synchronized price and add-to-cart
  state. Never invent availability or substitute for a sold-out framed option.
- The current catalog's above-180-cm rolled-only setup is not a universal
  manufacturing rule. Do not infer rollability from dimensions or images;
  heavy texture and exceptional delivery require production confirmation.
- Draft template prices can be zero. Do not copy them into purchasable products.
  Confirm nonzero pricing, exact variant combinations, media readiness,
  publication and collection membership before publishing.
- Shopify prices and checkout stay in USD. Local-currency amounts are display
  estimates only; avoid double conversion and third-party currency plugins.
- Do not invent sales evidence, best-seller status or customer reviews.
  Coordinating paintings sold individually must not be described as an included
  multi-piece bundle.

## Local tooling and cleanup

- Run `pnpm css` after CSS or utility-class changes; include the corresponding
  built `assets/theme.css` when committing those changes. Run `pnpm verify`
  and `git diff --check` before reporting completion.
- Use `agent-browser` for browser verification and screenshots. Distinguish
  local preview results from live verification in the completion report.
- Do not restore unrestricted theme push/pull package shortcuts. Legacy product
  creation and size migration require explicit legacy opt-in; that flag is not
  a recommendation or authorization to use them for the current catalog.
- Preserve original artwork, detail crops, room backgrounds, publication
  manifests and rollback backups. Keep store-specific scripts with their
  relative imports and state files. Do not rerun completed migration scripts.
- A missing literal filename match is not proof that an asset is unused:
  inspect dynamic references and merchant-managed content before removal.
- Preserve user changes and running development-server state. Archive known
  obsolete material reversibly and record what moved. Never print credentials
  while inspecting files or troubleshooting API responses.

## Critical synchronization model

- The live Shopify theme is connected to GitHub branch `origin/main`.
- Synchronization is bidirectional. GitHub changes deploy to Shopify, and
  changes made through the theme editor, Shopify Admin API, or Theme CLI can
  create an automatic GitHub commit such as `Update from Shopify for theme ...`.
- Treat Shopify, `origin/main`, and the local checkout as three copies of one
  shared state. Never assume the local checkout is current.

## Mandatory checks before editing

1. Run `git status --short --branch` and preserve all existing user changes.
2. Run `git fetch origin`.
3. Compare local and remote with
   `git rev-list --left-right --count HEAD...origin/main`.
4. If the worktree is clean, synchronize with
   `git pull --rebase origin main` before editing.
5. If the worktree is dirty or histories diverge, inspect both sides first. Do
   not reset, discard, overwrite, or blindly stash user work.

Repeat `git fetch origin` immediately before every rebase or push because
Shopify may have generated a new reverse-sync commit while the agent was
working.

## Authorization boundaries

- Do not modify the online theme, commit, or push unless the user explicitly
  asks for that action.
- A request to edit local code is not permission to deploy it.
- A request to update one online asset is not permission to upload the rest of
  the theme.
- Never force-push this repository.

## Store-content changes are separate from theme synchronization

- Product, collection, menu, page and policy updates generally live in Shopify
  data, not Git-tracked theme files. They do not normally produce a theme
  reverse-sync commit; do not wait for one or create a duplicate code change.
- Read current records, back up affected content, apply only the authorized
  changes, and re-read the affected records. Preserve IDs, ordering, unrelated
  fields and publication status unless the task explicitly changes them.
- For theme-file changes, continue to follow the reverse-sync procedure below.
  If a task touches both content and theme files, verify each independently.

## Merchant-owned theme state

Treat these as merchant-owned state, not ordinary generated source files:

- `config/settings_data.json`
- `templates/*.json`
- any section settings or blocks written by the Shopify theme editor

Do not replace these files wholesale from an older commit, a stale checkout, or
a local default. Pull and inspect the latest Shopify-generated commit first.
Preserve IDs, block order, resource references, and merchant-entered values
unless the user explicitly asks to change them.

## Safe online theme changes

- Prefer the Shopify Admin API for narrow, explicit theme-file updates.
- Read credentials from the ignored `.env`; never print credentials, access
  tokens, or `.shopify/admin-api-token.json`.
- Query the current theme with role `MAIN`; do not permanently hardcode a theme
  ID because the published theme can change.
- `write_themes` scope and Shopify's separate theme-files API eligibility are
  distinct. If a file mutation is restricted, report it and use the narrow
  Theme CLI fallback; do not broaden the upload.
- Back up every remote file that will be overwritten.
- Upsert or upload only the explicitly authorized filenames.
- If Theme CLI is required, always use explicit `--only` entries plus
  `--nodelete`; targeting the live theme also requires `--allow-live`.
- Never run an unrestricted `shopify theme push` against the live theme.
- After a theme-file API, theme-editor, or Theme CLI write, wait for Shopify's reverse-sync
  commit, then fetch it, inspect its changed paths, and rebase/fast-forward the
  local branch. Do not create a duplicate local commit for the same remote
  change.

## Mandatory checks before push

1. Confirm the requested work is complete and tested.
2. Commit locally if needed, then run `git fetch origin`.
3. Inspect new Shopify-generated commits and their changed paths.
4. Run `git rebase origin/main`.
5. Review `git diff --name-status origin/main...HEAD` and `git diff --check`.
6. Confirm that no unexpected template, settings, or asset files are included.
7. Push only after explicit user authorization.

## Verification and recovery

- For theme-file writes, re-read or pull the exact remote files and compare
  hashes or contents with the intended versions.
- Verify the storefront references the new CDN asset versions.
- Store temporary backups below `.shopify/`, which is ignored by Git, using a
  timestamped directory.
- Report the automatic Shopify commit when one exists, exact changed paths or
  store records, verification result, and backup location. State clearly whether
  work is local-only, committed, pushed, or verified live.
