# 新店搭建清单

本仓库是 Canvasra 的代码起点，但**还没有连接任何店铺**。下面按顺序做完，站点才算真正建立。
每一步都在本地或 Shopify 后台完成，不需要改动本仓库的代码。

## 1. 建店并取得 Admin API 凭据

> ⚠️ **动手前先定两件事 —— 它们在注册那一刻就锁定了，越晚处理越贵：**
>
> - **店铺国家/地区后台改不了。** 注册时选的地区决定 Shopify Payments 资格、套餐账单币种、
>   税务 nexus，改它只能联系 Shopify 支持人工处理（若已启用 Shopify Payments，字段通常直接置灰）。
>   香港在 Shopify Payments 支持国名单内，所以注册地正确时无需处理。
>   **选错国家的唯一低成本解法，是趁店铺内容还为零时重开一家** —— 商品和页面做起来之后，
>   迁移成本会迅速超过重开。
> - **商店货币只能在产生第一笔订单之前自行修改**（设置 → 商店详情）。
>   有订单之后后台置灰，只能找支持。而且**改币种不会换算已有商品价**
>   （标价 20 的商品，从 HKD 换成 USD 后会变成「20 USD」而不是等值换算）
>   → **务必在添加任何商品之前把币种设对**。

1. 在 Shopify 注册店铺，确定内部域名（形如 `canvasra.myshopify.com`）与主域名。
2. 到 Dev Dashboard（`dev.shopify.com`）创建应用。**2026-01-01 起 Shopify 后台的
   「开发应用」入口不能再新建自定义应用**（既有的 legacy 应用继续可用），新应用一律走
   Dev Dashboard：创建应用 → 发布一个带下面 scope 的版本 → 安装到店铺。

   ⚠️ **版本没发布之前应用根本装不上** —— 只创建应用、复制了凭据就以为完事，是最常漏的一步。
   症状：token 端点返回 `400 Oauth error app_not_installed`。注意这个错误说明
   **凭据是对的**（否则会报 `invalid_client`），问题只在「没安装」。

3. 配置 Admin API 权限范围，至少包含：

   `write_products` `write_files` `write_publications` `write_inventory` `write_content`

   **只需列 `write_*`。** Shopify 官方规则：*"Any permission to write a resource includes
   permission to read it"* —— write 隐含同名 read。授权后从店铺读回的 scope 串里只有
   `write_products` 而没有 `read_products` 是**正常现象**，**不要再去补那 5 个 read scope**。

   若还要用 Shopify CLI 预览或推送主题，另需 `read_themes` 与 `write_themes`。
   注意 **CLI 不读本文件**：它的认证只认一次 `shopify auth login`，或
   `SHOPIFY_CLI_THEME_TOKEN`（token）加 `SHOPIFY_FLAG_STORE`（域名）两个环境变量。

4. 在 Dev Dashboard 应用页的「安装」区把应用**安装到本店**，再复制 Client credentials 的
   ID 与 Secret。Dev Dashboard 应用的 token 通过 client credentials grant 换取，
   **24 小时后过期**，需要时就重新换一次。
5. 在仓库根目录 `cp .env.example .env`，填入：

   ```
   SHOPIFY_STORE=canvasra.myshopify.com
   SHOPIFY_CLIENT_ID=<client id>
   SHOPIFY_CLIENT_SECRET=<client secret>
   SHOPIFY_STOREFRONT_HOST=canvasra.com
   SHOPIFY_CURRENCY=USD
   ```

   `.env` 已被 gitignore，**不要提交**。

6. 验证连接：跑只读探针 `node .shopify/tmp/probe-store.mjs`（打印各键是否已填、
   token 端点原始响应、店铺真实主域名/币种，以及 `assertStore` 预判）；
   或打开 `pnpm studio`（本机 `:4310`），在「模型与店铺」里刷新店铺规则。

   **`assertStore` 守卫**（`scripts/product-studio/store-identity.js`，由 `shopify.js`
   与 `rules.js` 调用）要求 Admin API 返回的 `shop.primaryDomain.host` 与 `currencyCode`
   与上面两项**完全相等**，否则拒绝一切读写 —— 这是防止旧凭据误写到别家店。

   ⚠️ **新店在绑定自定义域名之前，主域名就是 `xxx.myshopify.com`，这一项必然失败。**
   临时把 `SHOPIFY_STOREFRONT_HOST` 写成 `xxx.myshopify.com` 让 Studio 先跑起来，
   **绑定好 `canvasra.com` 并设为主域名后必须改回 `canvasra.com`**。

   > 换了一家店、或改了域名/币种之后，**重新跑一次这个探针**再继续，别靠记忆。
   > 探针在 `.shopify/` 下（该目录整体 gitignore，不会进交付包）。

## 2. 建立代码远端与主题同步

1. 在 GitHub 新建一个**空的私有仓库**。
2. 本地绑定远端并推送 `main`：

   ```sh
   git remote add origin <仓库地址>
   git push -u origin main
   ```

3. 建立 Shopify 主题 ↔ GitHub 的双向同步：
   **在线商店 → 主题 → 主题库 → 添加主题 → 从 GitHub 连接** →
   选账户 → 选仓库 → **选分支 `main`**。此后主题编辑器与 Admin API 的改动会反向生成提交。

   六个必须知道的点：

   - **这个动作会在主题库里【新建】一个主题**，不是把已有主题挂到分支上。若此前已用 Theme CLI
     推过一个同名主题，连完之后它就是多余的，可以删掉。
   - **分支必须先存在** —— 后台是「搜索分支」，不会替你创建。所以先推 `main` 再连。
   - **后台的改动会自动提交到该分支，而且无法关闭**（约 10 秒内的编辑合并成一条
     `Update from Shopify for theme …`）。这就是为什么它与你手动提交的代码历史会混在一起 ——
     **本地改完要推送前一定先 `git fetch` 再 rebase**。
   - **主题编辑器没有冲突提示**：编辑器保存的版本会**直接覆盖** GitHub 版本。
     别在后台和本地同时改同一个文件。
   - **不符合默认主题目录结构的文件夹会被忽略**，不会同步进主题
     ⇒ 仓库根部的 `scripts/` `docs/` `src/` `.agents/` **只留在 GitHub，不会进店铺主题**。
   - 手动重新同步：主题卡片 → **Actions → Reset to last commit**；
     排查推送/拉取异常：卡片上的 **View logs**。
     ⚠️ **分支一旦断开就无法重连到同一主题** —— 重连等于再建一个新主题。

4. **首次部署主题必须显式授权**：用 Theme CLI 且务必带 `--only` 逐文件上传或首次全量上传，
   参照 `docs/SHOPIFY_GITHUB_WORKFLOW.md`。本仓库刻意没有开放 `push`/`pull` 快捷命令。

## 3. 建立店铺内容（主题里的 handle 依赖这些）

> **逐条可勾选的清单见 [`docs/STORE_CONTENT_CHECKLIST.md`](./STORE_CONTENT_CHECKLIST.md)**
> （交互版 `docs/store-content-checklist.html`，可在浏览器里逐条勾选并记进度）。
> 下面只讲原则与容易踩的点；handle 的全集与「缺失后果」以那份清单为准。

- **集合**：至少建立 `all-products`、`new-arrivals`、`best-sellers`、`oversized-art`，
  与 `config/settings_data.json` 的 `explore_handles` 保持一致。
  `all-products` 缺失**不会再造成 404**（首屏 CTA 与 `/collections/all` 的 canonical 都会回退到内置的
  `all` 合集），但页脚 Explore 的另外三个仍需自己建，否则对应链接无去处。
- **商品科目导航**：编辑 `snippets/collection-subject-handles.liquid`，
  使其中的 handle 与真实集合 URL 对应；翻译文件与菜单同步更新。
- **页面**：新建心愿单页并在主题设置里选中；新建联系页。
- **政策**：填写配送与退款政策，使 `/policies/shipping-policy` 与 `/policies/refund-policy` 可用
  （PDP 政策折叠区与相关测试依赖它们）。
- **菜单**：主菜单与页脚菜单按新店重排；不要沿用旧店的条目。
- **首页各区块图片**：原先指向**上一个店面 CDN 文件**的 10 处引用已于 2026-10-05 清空
  （`home-subject-1..5`、`home-our-approach`、`home-space-1..4`），并**填入主题自带的本地封面**
  （`cover_asset`，2026-10-05 生成的占位级素材，母版在未跟踪的 `.shopify/gen/originals/`）：

  | 区块 | 本地封面 |
  | --- | --- |
  | Shop by subject | `subject-abstract` / `subject-landscapes` / `subject-botanicals` / `subject-figurative` / `subject-still-life`.webp（1122×842，4:3） |
  | Our approach | `approach-studio.webp`（1248×936，4:3） |
  | Shop by space | `room-living-room` / `room-bedroom` / `room-dining-room` / `room-entryway`.webp（1024×1280，4:5） |

  这些是**替代用图，不是最终商品摄影**：拿到实拍后直接在主题编辑器里给区块选图即可覆盖，
  不必改代码。取图优先级：`collections-row` 与 `compositions` 先取 `image`、再取 `cover_asset`、
  再取合集特色图与首个商品图；`image-with-text` 相反，先取 `cover_asset`、再取 `image`
  ——因此替换时往哪个字段填要按对应区块来。
- **两处门店文案已补齐**（2026-10-05）：`collections` 五个 block 的 `title` 依次填为
  Abstract / Landscapes / Botanicals / Figurative / Still Life，`compositions` 的 `s3`（dining-room）
  角标填为 `Shop Dining Room`。此前这两处留空，会分别退化成 `Collection` 与 `Shop the room`。
  注意 block 级 `title` 优先级高于 `col.title` —— 日后若合集命名与这些标签不一致，改这里。
- **商品页工艺图已接入本地素材**（2026-10-05）：`templates/product.json` 的两处旧店引用
  （`craftsmanship-hand-painted.png`、`craftsmanship-materials.png`）先前已清空，现填入 `cover_asset`：
  `craft-studio.webp`（画室场景）与 `craft-materials.webp`（材料特写），均 1248×936 / 4:3。
  为此给 `sections/product-craftsmanship.liquid` 的 row block 补了一个 `cover_asset` 文本字段
  （回退链 `image` → `cover_asset` → 占位图），写法与首页两个区块一致。
  ⚠️ 这两张是**生成图，不是真实生产过程记录**；上线前请确认「Painted by hand / our artists /
  our own framing workshop」这些文案与实际生产方式相符。
- **客服邮箱**：迁移时暂用 `service@canvasra.com`。请确认实际邮箱，
  需要改的地方是 `config/settings_data.json` 与 `templates/product.json` 里的政策文案。
- **内容未建齐时的降级行为已于 2026-10-05 在代码层处理完**，因此不必抢在内容之前上线：
  - 首屏 CTA 引用的 `all-products` 不存在时回退到内置 `all` 合集；配置项若是 `shopify://` 资源引用，
    一律归一化成该资源的真实路径，绝不会输出 `shopify://` 开头的 `href`。
  - Our approach 区块的按钮指向 `our-story` 页面，该页面未建立时**整个按钮不渲染**（文案照常显示），
    避免点进 404。
  - `/collections/all` 的 canonical 只在 `all-products` 合集真实存在时才改写，否则保持指向自己。
  - 专栏区块在没有任何已发布文章时**整块不输出**（此前会渲染 3 张灰色占位卡）；主题编辑器里仍显示占位，
    方便选中与配置。
  - 所有页面都有 `og:image`：有 `page_image` 用之，否则回退到仓库自带的 `assets/og-default.webp`
    （1200×630，由首屏图裁出）。**拿到正式品牌图后建议替换该文件**，文件名保持不变即可。
  - 「New in」区块仍有静默回退链（`all-products` → `frontpage` → `all`）：`all-products` 未建时
    标题写着「New in」而内容是全部商品。这是语义问题不是故障，建好合集即消失。

## 4. 配置 Product Studio 的模型

在 `pnpm studio` → 模型与店铺 中填入两组配置（密钥只保存在本机 `settings.json`，不入库）：

- **作品分析与画作定位**：支持图片输入、返回 JSON 的 Chat Completions 兼容接口。
- **生图模型**：按服务商协议选择 `reference-json` 或 `openai-edit`。

`settings.json` 被 gitignore，**空账本起步**：没有历史任务或图库。
`scene-references/` 只跟踪了 `README.md`，场景参考图需要另行放入。

## 5. 上线前自检

- `pnpm css` 后 `assets/theme.css` 无差异（改了样式才需要）。
- `pnpm verify`：Theme Check + 离线测试，**2026-10-05 起两者均全绿**：
  Theme Check 84 文件 0 error / 1 warning（`artwork-scene` 一个「为兼容保留」的未用参数，无害）；
  离线测试 366 项 → 365 通过 / 1 跳过 / 0 失败（跳过项需要隔离的 Pillow 环境）。
  需要 Playwright 的 `banner.test.js` 已加 120 秒上限：本机 Chromium 卡住时**报错退出而不是挂死**。
- 首次上架前按 `docs/PRODUCT_IMAGE_RULES.md` 核对素材与定价。
