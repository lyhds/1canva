# 当前项目状态

核对日期：2026-10-05。本仓库是 **Canvasra** 的全新起点，由上一个店面前端的主题与 Product Studio 工具链迁移而来。

## 本仓库的定位

- 目标店铺：`canvasra.com`（内部 `*.myshopify.com` 域名配在 `.env`，不写进代码）。
- 销售模式：**纯 Shopify 直营**——商品在 Shopify 上架并直接结账。不经过任何外部电商平台，因此没有导入、同步或二次发布链路。
- 迁移范围：完整 Shopify 主题（Liquid 模板、Tailwind 源、静态资源）+ Product Studio + 离线测试与脚本。
- **未迁移**：上一个店面的任务账本、图库、商品数据与备份。本仓库以空账本开始。

## 尚未执行（需要店主授权与新店凭据）

以下都还没做过，任何一项都不能当成已完成：

- 创建 Shopify 店铺、自定义应用并签发 `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`
- 填写 `.env`（`SHOPIFY_STORE` 必须是 `*.myshopify.com`）
- 新建 GitHub 远端仓库，并建立主题 ↔ `origin/shopify` 的双向同步
- 首次把主题推送到线上主题
- 建立商品集合、导航菜单、页面与政策（主题里的 handle 引用需要与之一致）
- 配置 Product Studio 的分析与生图模型密钥（`.shopify/product-studio/settings.json`，被忽略，不入库）
- 确认客服邮箱与政策文案（迁移时暂用 `service@canvasra.com`）

## 迁移时做过的处理

- 品牌字样、主题资源名（含 favicon 与本地存储键）、npm 脚本名与技能目录已全部改为 Canvasra。
- 店铺域名全部改为配置驱动（`scripts/product-studio/store-identity.js`），原先 5 处硬编码的
  旧店域名断言已移除。
- 保持不变：`ochre-*` 场景/媒体**协议标记**（主题与 Studio 之间的发布门禁契约）与
  `scripts/ochre-*.js|py` 内部文件名。它们是与 Product Studio 共享的内部标识，不是品牌字样。

## 验证

- 本仓库尚未连接任何真实店铺，因此**没有任何线上验证**。
- 离线测试结果见本次迁移交付说明；未验证边界包括真实付费生图、Shopify 写入与主题部署。

## 本地状态与交付边界

`.shopify/` 下的任务、素材、凭据与备份不随 Git 迁移。`scene-references/` 只跟踪 `README.md`，
其余为本地参考图，需另行准备。远端主题与 `origin/shopify` 双向同步的规则见
[同步与部署](SHOPIFY_GITHUB_WORKFLOW.md)。
