# Canvasra 建店清单（可勾选）

主题代码已就绪，**上线只差店铺侧的内容与设置**。本清单把「主题依赖什么」逐条列出，
每条都注明 **handle**（必须完全一致）、**谁在引用它**、**缺失会怎样**。

> 交互版：用浏览器打开仓库里的 `docs/store-content-checklist.html` 可逐条勾选、自动记进度。
> 本 Markdown 是同一份内容的可版本化版本，供 PR / 交接使用。

图例：**● 阻塞上线** ｜ ○ 必做 ｜ ◌ 可选

---

## 阶段 1 · 建店与凭据

- [ ] **○ 注册 Shopify 店铺，确定内部域名**（形如 `canvasra.myshopify.com`）
      Studio 用 `.env` 里的域名做断言，与实际不符会直接拒绝写入。
- [ ] **○ 创建开发应用并授权 Admin API 权限范围**
      `read_products` `write_products` `read_files` `write_files` `read_publications`
      `write_publications` `read_inventory` `write_inventory` `read_content` `write_content`
- [ ] **○ 创建 `.env` 并填入 5 项**
      `SHOPIFY_STORE` / `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` /
      `SHOPIFY_STOREFRONT_HOST` / `SHOPIFY_CURRENCY`。`.env` 已 gitignore，**不要提交**。
- [ ] **○ 验证连接**：`pnpm studio` → 「模型与店铺」→ 刷新店铺规则。

## 阶段 2 · 代码远端与主题同步

- [ ] **○ 新建 GitHub 空私有仓库**
- [ ] **○ 绑定远端并推送 `main`**：`git remote add origin <地址>` → `git push -u origin main`
- [ ] **○ 建立 Shopify ↔ GitHub 双向同步**（分支命名为 `main`）
      首次部署必须**显式授权**，用 `--only` 逐文件上传，见 `docs/SHOPIFY_GITHUB_WORKFLOW.md`。
      主题编辑器与 Admin API 的改动此后会反向生成提交。

## 阶段 3 · 集合（13 个必做 + 3 个可选）

**建议全部用「智能合集」**，新商品自动纳入，不必手工维护。
下列 handle 必须**逐字一致**（区分大小写）。

### 3.1 关键合集

- [ ] **● `all-products`**
      引用：`templates/index.json`（首屏最大按钮）、`config/settings_data.json`（页脚 Explore）
      建议条件：`Product price is greater than 0`
      **缺失后果**：首屏 CTA 与 `/collections/all` 的 canonical 会自动回退到内置 `all`（**不会 404**），
      但页脚 Explore 第一项失去去处、「New in」区块会静默退化成「全部商品」。

### 3.2 首页「Shop by subject」（5）

- [ ] **○ `abstract`**（首页卡片标签 Abstract，封面 `subject-abstract.webp`）
- [ ] **○ `landscapes`**（Landscapes / `subject-landscapes.webp`）
- [ ] **○ `botanicals`**（Botanicals / `subject-botanicals.webp`）
- [ ] **○ `figurative`**（Figurative / `subject-figurative.webp`）
- [ ] **○ `still-life`**（Still Life / `subject-still-life.webp`）

**缺失后果**：卡片封面照常显示（已在主题内），但点击会落到内置 `all` 合集 ——
名称写着 Abstract、点进去是全站商品。**合集页的 Subject 筛选也会少一项。**

### 3.3 首页「Shop by space」（4）

- [ ] **○ `living-room`**（封面 `room-living-room.webp`）
- [ ] **○ `bedroom`**（封面 `room-bedroom.webp`）
- [ ] **○ `dining-room`**（角标已填 `Shop Dining Room`，封面 `room-dining-room.webp`）
- [ ] **○ `entryway`**（封面 `room-entryway.webp`）

建议条件：`Product tag equals <handle>`（给商品打上房间标签即可归集）。

### 3.4 页脚 Explore（3）

- [ ] **○ `new-arrivals`** — 建议：`Product created date is in the last 30 days`，排序「最新」
- [ ] **○ `best-sellers`** — 建议：排序「最畅销」
- [ ] **○ `oversized-art`** — 建议：按尺寸条件或 `tag = oversized`

**缺失后果**：页脚「Explore」列对应条目无去处。

### 3.5 合集页 Subject 筛选（3，可选）

- [ ] **◌ `coastal`**
- [ ] **◌ `architecture`**
- [ ] **◌ `animals`**

这三个 handle 已列在 `snippets/collection-subject-handles.liquid`，
**翻译键也已备好**（`collections.subject.*`），建了就自动出现在筛选面板，不会显示 `translation missing`。
不建则整条跳过，**不影响任何其它页面**。

## 阶段 4 · 页面（6）

在后台「在线商店 → 页面」创建，handle 必须一致。页面内容本身可以后续再补，先建出来避免按钮 404。

- [ ] **○ `our-story`**（标题建议 Our Story）
      引用：首页 Our approach 区块的按钮 + 页脚 About 列
      缺失：**该按钮整个不渲染**（文案照常显示），不会点进 404
- [ ] **○ `our-approach`**（Our Approach）— 页脚 About 列
- [ ] **○ `materials-craft`**（Materials & Craft）— 页脚 About 列
- [ ] **○ `contact`**（Contact）
      引用：`snippets/size-guide.liquid` 的尺码弹窗「联系」入口（`pages['contact']`）
- [ ] **○ `wishlist`**（Wishlist）
      引用：`sections/header.liquid` 的页头心愿单图标
      handle 为 `wishlist` 即自动生效；也可在主题设置 `wishlist_page` 里显式选中
- [ ] **○ `custom-painting`**（Custom Painting）
      引用：尺码弹窗的「定制」入口，**优先于 `contact`**；缺失时自动回退到 contact，不报错

## 阶段 5 · 博客（1）

- [ ] **○ `journal`（≥ 3 篇已发布文章）**
      引用：首页专栏区块（`sections/editorial.liquid`）+ 页脚 `blog_handle`
      缺失后果：首页专栏**整块不输出**（2026-10-05 起不再露灰占位卡）；页脚文章链接无去处

## 阶段 6 · 菜单（2）

- [ ] **○ `main-menu`** — 页头主菜单。
      建议条目：Shop（→ `/collections` 或 `all-products`）、分类若干、Journal、About
      **缺失后果：页头导航空白。**
- [ ] **○ `footer`** — 页脚「Customer services」列。
      建议条目：Shipping、Returns、Contact、FAQ

## 阶段 7 · 政策（2）

后台「设置 → 政策」。注意 Shopify 预置的是**模板占位文案，必须替换成你的实际条款**。

- [ ] **○ 配送政策**（URL `/policies/shipping-policy`，后台自动生成）— 被 `templates/product.json` 的「Full shipping policy」链接引用
- [ ] **○ 退款政策**（URL `/policies/refund-policy`）— 被 `templates/product.json` 的「Full return policy」链接引用
- [ ] **◌ 隐私政策 / 服务条款 / 联系信息**（建议一并填写）

## 阶段 8 · 商品（≥ 1 个，建议 6 个以上）

- [ ] **● 上架商品**
      PDP、购物车、集合页、搜索结果、筛选器、尺码弹窗**全部无法在零商品状态下真机验证**。
      首次上架前按 `docs/PRODUCT_IMAGE_RULES.md` 核对素材与定价。

## 阶段 9 · Product Studio 模型（2）

在 `pnpm studio` → 「模型与店铺」中配置（密钥只存本机 `settings.json`，不入库）：

- [ ] **○ 作品分析 / 画作定位模型**：支持图片输入、返回 JSON 的 Chat Completions 兼容接口
- [ ] **○ 生图模型**：按服务商协议选 `reference-json` 或 `openai-edit`

## 阶段 10 · 店铺设置（主题之外，但属上线）

- [ ] **○ 域名解析**到 Shopify
- [ ] **○ 支付方式**开通
- [ ] **○ 运费区域**配置
- [ ] **○ 税务**配置
- [ ] **○ 确认客服邮箱**：迁移时暂用 `service@canvasra.com`，实际邮箱需在
      `config/settings_data.json` 与 `templates/product.json` 的政策文案里同步

## 阶段 11 · 上线自检

- [ ] **○ 替换 Shopify 默认政策文案**
- [ ] **○ 确认商品页工艺图文案与实际生产方式相符**
      区块文案声称「our artists sketch and refine」「frames made in our own framing workshop」，
      而配图是**生成图、不是真实生产记录**。若实际链路不同，**连文案一起改**。
- [ ] **○ 全站占位图走查**：首页与商品页的封面当前用的是替代素材（母版在 `.shopify/gen/originals/`），
      拿到实拍后在主题编辑器中覆盖即可，**不必改代码**
- [ ] **○ 替换 `assets/og-default.webp`**：当前由首屏图裁出（1200×630），
      拿到正式品牌图后**覆盖同名文件**即可，无需改代码
- [ ] **○ 跑 `pnpm verify`**：Theme Check 84 文件 0 error / 1 warning（无害）；
      离线测试 366 项 → 365 通过 / 1 跳过 / 0 失败

---

## 两个容易踩的点

1. **block 级 `title` 优先于合集名。** 首页五张卡的标签已写死为
   Abstract / Landscapes / Botanicals / Figurative / Still Life。
   日后合集若命名不同（如「Abstract Paintings」），页面仍显示短标签 —— 改 `templates/index.json` 的 block `title`。
2. **取图优先级因区块而异。** `collections-row` 与 `compositions` 先取 `image` 再取 `cover_asset`；
   `image-with-text` 与 `product-craftsmanship` 相反（先 `cover_asset`）。
   在主题编辑器里选图时，往哪个字段填取决于区块。

## 复核方式

```sh
# 静态审计：扫出所有「引用了但店铺里还不存在」的资源
node .shopify/audit/readiness.js

# 翻译键审计：确认没有 translation missing
node .shopify/audit/i18n.js
```

两个脚本都在 `.shopify/audit/`（gitignored，不进交付包）。
