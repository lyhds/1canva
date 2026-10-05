# 新店搭建清单

本仓库是 Canvasra 的代码起点，但**还没有连接任何店铺**。下面按顺序做完，站点才算真正建立。
每一步都在本地或 Shopify 后台完成，不需要改动本仓库的代码。

## 1. 建店并取得 Admin API 凭据

1. 在 Shopify 注册店铺，确定内部域名（形如 `canvasra.myshopify.com`）与主域名。
2. 后台 → 设置 → 应用和销售渠道 → 开发应用 → 创建应用。
3. 配置 Admin API 权限范围，至少包含：

   `read_products` `write_products` `read_files` `write_files`
   `read_publications` `write_publications` `read_inventory` `write_inventory`
   `read_content` `write_content`

4. 安装应用，复制 Client credentials 的 ID 与 Secret。
5. 在仓库根目录 `cp .env.example .env`，填入：

   ```
   SHOPIFY_STORE=canvasra.myshopify.com
   SHOPIFY_CLIENT_ID=<client id>
   SHOPIFY_CLIENT_SECRET=<client secret>
   SHOPIFY_STOREFRONT_HOST=canvasra.com
   SHOPIFY_CURRENCY=USD
   ```

   `.env` 已被 gitignore，**不要提交**。

6. 验证连接：打开 `pnpm studio`（本机 `:4310`），在「模型与店铺」里刷新店铺规则。
   若域名或币种与 `.env` 不符，Product Studio 会直接拒绝，不会写入。

## 2. 建立代码远端与主题同步

1. 在 GitHub 新建一个**空的私有仓库**。
2. 本地绑定远端并推送 `main`：

   ```sh
   git remote add origin <仓库地址>
   git push -u origin main
   ```

3. 建立 Shopify 主题 ↔ GitHub 的双向同步（Shopify 后台 → 在线商店 → 主题 → 连接 Git），
   把分支命名为 `shopify`。此后主题编辑器与 Admin API 的改动会反向生成提交。
4. **首次部署主题必须显式授权**：用 Theme CLI 且务必带 `--only` 逐文件上传或首次全量上传，
   参照 `docs/SHOPIFY_GITHUB_WORKFLOW.md`。本仓库刻意没有开放 `push`/`pull` 快捷命令。

## 3. 建立店铺内容（主题里的 handle 依赖这些）

- **集合**：至少建立 `all-products`、`new-arrivals`、`best-sellers`、`oversized-art`，
  与 `config/settings_data.json` 的 `explore_handles` 保持一致。
- **商品科目导航**：编辑 `snippets/collection-subject-handles.liquid`，
  使其中的 handle 与真实集合 URL 对应；翻译文件与菜单同步更新。
- **页面**：新建心愿单页并在主题设置里选中；新建联系页。
- **政策**：填写配送与退款政策，使 `/policies/shipping-policy` 与 `/policies/refund-policy` 可用
  （PDP 政策折叠区与相关测试依赖它们）。
- **菜单**：主菜单与页脚菜单按新店重排；不要沿用旧店的条目。
- **首页各区块图片**：`templates/index.json` 里仍有若干指向**上一个店面 CDN 文件**的引用
  （`shopify://shop_images/home-subject-*.png`、`home-our-approach.png`、`home-space-*.png`），
  这些文件在新店并不存在。首屏已在迁移时改为仓库内的本地资源，其余区块需要你上传新图后在主题编辑器里重新选中，
  否则「Shop by subject / Our approach / Shop by space」会退化成占位图。
  取图优先级：`collections-row` 与 `compositions` 先取 `image`、再取 `cover_asset`；
  `image-with-text` 相反，先取 `cover_asset`——因此给区块配本地图时，往哪个字段填要按对应区块来。
- **客服邮箱**：迁移时暂用 `service@canvasra.com`。请确认实际邮箱，
  需要改的地方是 `config/settings_data.json` 与 `templates/product.json` 里的政策文案。

## 4. 配置 Product Studio 的模型

在 `pnpm studio` → 模型与店铺 中填入两组配置（密钥只保存在本机 `settings.json`，不入库）：

- **作品分析与画作定位**：支持图片输入、返回 JSON 的 Chat Completions 兼容接口。
- **生图模型**：按服务商协议选择 `reference-json` 或 `openai-edit`。

`settings.json` 被 gitignore，**空账本起步**：没有历史任务或图库。
`scene-references/` 只跟踪了 `README.md`，场景参考图需要另行放入。

## 5. 上线前自检

- `pnpm css` 后 `assets/theme.css` 无差异（改了样式才需要）。
- `pnpm verify`：Theme Check + 离线测试。
- 已知在本机必然失败、与代码无关的三类：`spawnSync EBUSY`（`theme-contracts` 的 CSS 构建、
  `build-mesonart-catalog`）、`env:{}` 下 `project-hygiene` 的 legacy 用例、
  以及需要 Playwright 浏览器的 `banner.test.js`。
- 首次上架前按 `docs/PRODUCT_IMAGE_RULES.md` 核对素材与定价。
