# Script inventory

## Current local tooling

- `build-mesonart-catalog.js <saved variants.json> [--apply]`: 离线构建六比例精确美元价表和 PRICE_TABLE 文档；按独立商品计算逐组合众数，平票中止，保留来源与频次。原始抓取不全时必须披露样本范围。默认只输出 dry-run 计划（含目标文件是否变化），**不写文件**；`--apply` 先把 `data/pricing/mesonart-catalog.json` 与 `docs/PRICE_TABLE.md` 复制到 `.shopify/backups/<时间戳>-price-table/` 再写入。回归测试 `build-mesonart-catalog.test.js` 在临时目录中验证这两条路径。
- `migrate-catalog-reference.js --backup=.shopify/backups/<directory> [--exclude=gid://shopify/Product/<id>]`: 六比例全目录调整工具；默认计划，`--preflight` 只核对，显式 `--apply` 才写。`--exclude` 可指定一件本次不处理的商品（不再内置任何固定商品 ID）。备份必须完整；最大化保留变体 ID，记录退休组合；删除前核实商品接口可用库存为零，不写库存数量。当前凭据无 read_inventory，位置级 on_hand/committed 无法读取，不声称已备份它们。逐商品回读并保留商品内容、媒体、集合及渠道。结果不明时先核对，禁止盲重发。仅用于此次授权，不是日常创建入口。

- `migrate-square-sizes.js`: 本次早期方形单独方案，尚未执行，已由全比例方案取代；不得再应用早期计划。

- `apply-retail-prices.js --backup=.shopify/backups/<directory>`: 从已备份的 `before.json` 生成统一价格表变更计划；显式 `--apply` 更新变体 `price`（= 原价 × 0.6）与 `compareAtPrice`（= 偏移价表原价），回读并检查其他字段。可恢复执行；并发或部分变更会中止。六个 `[RATIO DRAFT]` 不改价。原价含按商品 ID 的确定性 ±15 美元偏移（见 PRICE_TABLE.md），计划文件记录每件商品的 offset。不可在没有本次授权时运行。
- `snapshot-retail-prices.js .shopify/backups/<directory>`: 生成全店商品快照 `before.json`（含 price 与 compareAtPrice），供重定价脚本使用。

- `product-studio/server.js`: local product workflow web app (`pnpm studio`); model calls and Shopify writes occur only when a task is started. See [Product Studio](PRODUCT_STUDIO.md).

- `bootstrap-store-baseline.js`: one-off cold start for a brand-new storefront. The
  Studio pipeline cannot price anything until `resolveStoreRules()` finds, for the
  artwork's ratio, one `[RATIO DRAFT]` template *and* an ACTIVE reference covering
  every template variant — store-side records a migrated store brought along with
  its catalogue, but a fresh store has none. This derives both from
  `data/pricing/mesonart-catalog.json`: six zero-priced DRAFT templates and six
  ACTIVE references kept unpublished (sellable for the rule check, invisible to
  shoppers; verified `publishedAt: null` with variants still `availableForSale`).
  Read-only plan by default; `--apply` writes and `--ratio=<r>` limits the scope.
  Idempotent by handle, so it only fills what is missing. Do not run it against a
  store that already has a catalogue.

- `ochre-workflow.js`: local Codex task/version/approval/operation ledger (`pnpm canvasra`); no network calls.
- `ochre-crop.py`: deterministic master crop with hash provenance; requires Python Pillow.
- `ochre-generate.js`: paid OpenRouter image request only after explicit authorization; journals before request and never auto-retries. See [Codex workflow](CODEX_PRODUCT_WORKFLOW.md).

- `preview-shopping.js`: fixture storefront, no Admin writes.
- `*.test.js`, `test-support/`: offline regression tests. Keep all tests,
  including legacy compatibility tests; old stored carts/products still exist.
- `api.ps1`: generic Admin API helper; execution authority depends on the query.
- `set-orientation.js`: derives orientation from artwork dimensions. Default is
  dry run; `--apply` writes. Run only after inspecting target products.
- `setup-reviews.js`: review administration, not a way to fabricate reviews.
  Destructive cleanup requires `--clean --yes`; leave dormant unless needed.

## Retired workflows kept for compatibility

- `create-product.js`: old 5-size × 4-frame schema, old API fallback and price
  ladder. Blocked without `--allow-legacy`; even then it only prints a plan
  (sizes, frame list, variant count, upload list, target status) unless
  `--apply` is also passed. With `--apply` it creates the product and reads it
  back — title, status, option values, variant count and media count/alt — and
  exits non-zero on any mismatch; a non-READY media status is reported, not
  treated as failure. Its tests verify historical behavior, not the current
  catalog. Do not use for new catalog products.
- `migrate-size-values.js`: old S–XXL conversion. Read-only plan by default;
  writes require `--apply --allow-legacy`. Never run over the current dimension
  ladders just to normalize them.
- `make-frame-textures.py`: legacy source-photo texture generator. Keep for
  reproducibility; it is not the source of all six current finish assets.

`--help` on the administrative CLIs is offline-safe. Current product standards
are in [PRODUCT_IMAGE_RULES.md](PRODUCT_IMAGE_RULES.md). The recent batch's
resumable scripts and manifests are under ignored `.shopify/catalog-fill/`;
these are store-specific operational records, not a polished general CLI.
Do not rerun them casually or delete their idempotency manifests.

## Local state retention

- `.shopify/backups/`: rollback/readback evidence; retain.
- `.shopify/catalog-fill/`: originals, detail crops, room backgrounds, publication
  manifests and scripts; retain together because scripts use relative imports.
- `.shopify/generated/`, `.shopify/research/`: reference/source material and
  prior publication evidence. Archive as a whole only after reviewing links.
- `.shopify/admin-api-token.json`, `.env`: sensitive authentication state.
  Never print, commit or upload. Not part of generic cleanup.
- Dev-server PID/log: keep while its process is running; don't remove blindly.
