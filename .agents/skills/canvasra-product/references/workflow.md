# 命令与数据契约

所有命令在仓库根目录运行，`node scripts/ochre-workflow.js` 可简写为 `pnpm canvasra`。
任务目录 `.shopify/canvasra-workflow/` 被忽略，保留原图和所有版本，不运行自动清理。

## spec.json

```json
{
  "mode": "create",
  "mediaProfile": "responsive-v1",
  "sceneWorkflow": "lighting-v1",
  "ratio": "4:3",
  "rightsConfirmed": true,
  "textureDecision": "omit",
  "textureReason": "主图无明显堆积肌理，侧面展示价值低",
  "productionConfirmed": false
}
```

示例不是确认记录。rightsConfirmed 和 productionConfirmed 必须有实际确认依据，可在 spec 中追加 rightsEvidence、productionEvidence、baseStretchedPriceCents、generationAuthorization 等字段。肌理及侧面图取舍按 SKILL.md 自动决定 include/omit，依据不足时 omit，不为素材选择请求确认。旧任务的 needs-confirmation 应重新检查依据后通过 spec 命令记录决定；实际制作交付冲突仍须保留生产阻断，不能用 omit 绕过。

## 三个 JSON 文档

- rules：保存 store.primaryDomain、currency、fetchedAt、模板 IDs/updatedAt、每个比例完整 options/variants、已确认工艺和政策来源。不要包含凭据。
- pricing：`currency: "USD"`、`confirmed: true`、`referenceProductIds: ["gid://shopify/Product/..."]`、`rounding: "用户确认的取整规则"`、`variants: [{"size":"实际尺寸", "frame":"实际框名", "priceCents":10500}]`。保存基价、倍率、加价和用户确认依据作为附加字段。脚本只检查最低数据完整性；Codex 必须比对实时模板的精确组合，不可将 boolean 当作真实确认。
- copy：title、descriptionHtml、seoTitle、seoDescription、tags、collections，以及规则来源。不凭图像编造生产事实。

用 `document ID rules|pricing|copy FILE` 导入不可覆盖的副本。每次改变 spec、已接受图片或文档都会取消最终 approval。

当前店主已授权自动素材接受与全自动商品流程，accept/approve 的证据引用该长期授权和 Codex 实际验收记录，不再逐阶段询问，也不伪称用户逐张审阅。下方显式确认示例是命令格式示例；授权范围与事实缺口以 SKILL.md 的当前规则为准。

## 本地使用例

```sh
pnpm canvasra init my-painting
pnpm canvasra spec my-painting .shopify/canvasra-workflow/my-painting/spec.json
pnpm canvasra import my-painting reference /absolute/reference.png reference
pnpm canvasra import my-painting master /absolute/master.png generated
pnpm canvasra accept my-painting <version-id> "用户明确接受主图"
.shopify/canvasra-python/bin/python scripts/ochre-crop.py /absolute/accepted-master.png /absolute/detail.png 100 100 500 500
pnpm canvasra import my-painting detail /absolute/detail.png crop
pnpm canvasra status my-painting
```

裁切参数依次 x y width height，像素单位。不能覆盖已有文件。需要 Python Pillow；按 docs/CODEX_PRODUCT_WORKFLOW.md 安装隔离环境。导入 detail 时必须存在裁切脚本生成的 IMAGE.json sidecar，且其源哈希匹配当前接受主图。

## 外部操作日志

```sh
pnpm canvasra begin my-painting generate-master-1 generation "用户批准指定模型的一次主图生成"
# Codex 现在调用生成服务，记录请求模型、提示词版本、引用图哈希、费用及产物。
pnpm canvasra finish my-painting generate-master-1 /absolute/receipt.json
```

receipt 示例：

```json
{
  "status": "complete",
  "evidence": "已保存结果并检查返回格式",
  "model": "实际模型ID",
  "costUSD": null,
  "output": "本地结果路径"
}
```

未知费用用 null。响应正文或日志可能包含敏感信息，不要原样保存请求 headers。免费本地图像处理不需要付费授权日志。

状态 complete 表示该阶段真实成功；uncertain 表示付费请求/写入可能成功但未确认；cancelled 只在核对确定没有执行或不会重复产生效果时使用。pending/uncertain 阻止下一操作和素材变更。核对后再次 finish，不能删除旧操作来绕过。

Shopify 写入：完成所有本地审核后 `approve ID <status输出digest> "明确发布授权"`，再 `begin ID create-draft shopify EVIDENCE`。每个 stage 独立 key（create-draft、upload-media、set-variants、publish 等），所有操作都先记 pending 再调用 API。

创建成功立即 finish，receipt 记录 productId（gid://shopify/Product/...）。中断恢复先按任务标签查询，不靠标题识别，不允许将任务绑定到另一个商品。原始快照、创建响应和回读留在任务目录。

发布完成 receipt 还须带 `published: true, readbackVerified: true`。这两个值仅允许在实际回读与线上验收后写入。脚本无法替代远端验证，也不自动执行任何请求。

## Codex 桌面安装

官方规范： https://developers.openai.com/codex/skills/
仓库级技能位于 `.agents/skills/canvasra-product/SKILL.md`。在 Codex 桌面打开包含这些文件的本地仓库，明确调用 `$canvasra-product` 或要求使用 CANVASRA 商品技能。新技能未出现时重启/重新打开项目；实际桌面发现与图片预览仍需在用户机器验证。

不需要安装到全局，不绑定开发服务器 `/root` 路径。把项目带到桌面电脑时，忽略目录不会随 Git 迁移；参考图库、任务及密钥须由用户安全迁移。不要传 token 到对话。

## 生图方式

在 spec 中保存 `"generation": {"provider": "codex"}` 或 `"generation": {"provider": "custom-api"}`。切换时读取完整现有 spec，仅修改 generation，再通过 spec 命令保存，保留其他字段。切换方式不清空已接受图片，但会取消最终发布审核。

### Codex 直接生成

1. 保存提示词、参考图来源/哈希、所选 provider 到任务目录的独立操作说明；不要记录凭据。
2. `begin ID OPERATION generation EVIDENCE`，证据引用用户本次或此前覆盖本次的生图请求。
3. 调用当前会话内置 image_gen；本地参考图先查看，按实际工具支持的参数传入。工具不可用则报告，不能偷偷改成付费 API。
4. 将工具返回的实际图片复制到任务目录的唯一新文件名，检查真实画面与比例。不要假设默认输出目录或伪造本地路径；没有可持久化产物则保留待核对状态。
5. 保存 receipt：`status`、`evidence`、`provider: "codex"`、`model: null`（工具有返回才写实际模型）、`costUSD: null`（未知不等于免费）、`output`、`sha256`。调用 finish 后再 import。失败或结果不明用 uncertain；确认没有执行时才 cancelled。
6. 展示实际结果，按店主长期自动接受授权由 Codex 检查后 accept 并继续。生成成功不等于质量合格。

内置工具由 Codex 会话调用，Node 脚本不模拟该工具。`ochre-generate.js` 拒绝 provider=codex，不发网络请求。

### 自定义 API

配置和协议见根目录 docs/CODEX_PRODUCT_WORKFLOW.md 的“自定义 API”。脚本自动 begin/finish，外部不要重复 begin。图片生成后仍需 import、展示和 accept。保留旧 OpenRouter 配置兼容性；任何接口格式变化都应显式适配并测试。

## Responsive product media (2026-09-08)

This supersedes earlier image-count and new-scene aspect-ratio examples for new
responsive tasks; preserve existing published products and saved tasks.

- Share the complete `master`, actual-crop `detail`, optional `texture`, and two
  ordinary room scenes. Keep original artwork ratios; never crop the artwork to
  fit the viewport.
- Three portrait room backgrounds use **4:5**: `scene-1/2` upload with
  `alt=scene-room-v1`; the large `scene-3` uses `alt=scene-room-large-v1` and
  left10%, top0%, width80%, height78%. Check the actual composite, header and furniture.
- Add **one 3:2 landscape** background (`scene-desktop`,
  `alt=scene-room-desktop-v1`). Recompose the large-room reference, keeping the
  same room style and lighting; do not stretch or blindly crop the portrait.
  Clear wall: left28%, top20%, width44%, height50%; furniture below75%.
- Total: **6 images without texture; 7 with texture**. Shopify order is
  master/detail/optional texture/scene-1/scene-2/scene-3/scene-desktop.
  Both rooms are empty backgrounds; the theme overlays the same artwork/frame.
- Desktop >=1024px: separate full-viewport landscape hero, then purchase gallery
  starting with master. Mobile: large portrait scene first, followed by master
  and remaining shared media in a 4:5 swipe track. The desktop background is
  excluded from the swipe gallery and lightbox. Product cards still use master.
- Validate native ratios, all six artwork ratios and eight frame/delivery looks,
  portrait mobile, and 16:9 / 16:10 / 3:2 desktop composites. Hero cover crops the
  composed plane, preserving artwork-to-room placement; extreme screens use
  contain. These are design visualizations, not to scale or physical-work photos.
- New ledger specs explicitly use `"mediaProfile": "responsive-v1"`; missing
  profile retains legacy requirements. Product Studio saves this profile on new
  jobs automatically and preserves jobs without it. Do not retrofit saved jobs.
- Before uploading the new background, verify the live theme supports this alt.
  Studio checks the live `ochre-media-profile` marker before Shopify creation/
  upload; code changes and local QA do not constitute deployment permission.
  Products without the desktop background retain their existing desktop layout.


新任务场景证据：先保存 `scene-lighting-plan.json`（每个scene slot的参考哈希、master版本、光源观察、方向、软硬、透视、锐度、适配办法），再保存 `scene-review.json`（每个背景版本/哈希、所有可售框色截图、八项真实感检查及实际依据、问题归因和修复记录）。在spec中记录证据路径与哈希。accept须引用对应版本的实际验收；旧任务不因恢复而被静默迁移。详见scene-lessons.md最新光影流程。账本blockers是最低技术检查，不能代替上述视觉验收。


## PC Banner 制作与替换规则（2026-09-08，优先于上述旧PC条款）

新任务使用 `bannerProfile: fullbleed-v2`，按[完整Banner制作与验收契约](../../../../docs/PRODUCT_BANNER_RULES.md)执行。原生21:9背景、独立v2挂画布局、全屏cover以及突破1920px页面上限必须配套；不要再沿用旧3:2小挂画区或超宽屏contain。该比例是本店适配方案，不冒称参考网站的图片比例。先计算实际画作占位，再生成背景；须检查四种屏幕和全部装裱的真实合成，视觉不通过不得上传。已有商品按版本保留，替换先备份。新版主题未部署时保留本地素材并明确阻断，不上传空背景。
