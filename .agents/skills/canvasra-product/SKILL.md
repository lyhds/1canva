---
name: canvasra-product
description: CANVASRA 专用商品生成与上架工作流。用于参考画作提取或创作、6–7 张响应式商品素材、三个可换框房间场景、英文文案、店铺真实变体定价、自动素材验收与可恢复发布。仅用于当前店铺；不是主题部署或无人审核批量发布工具。
---

# CANVASRA 产品工作流

在 Codex 桌面应用打开此仓库后使用。中文沟通，英文商品文案。技能负责推理和调用工具，脚本负责本地版本、审核摘要及操作日志；不要把本地校验通过说成线上发布通过。

## 先读

从本文件目录向上三级得到仓库根目录。阅读根目录 AGENTS.md、docs/SHOPIFY_GITHUB_WORKFLOW.md、docs/PRODUCT_IMAGE_RULES.md、docs/SCRIPTS.md，以及本技能 references/workflow.md。所有命令在根目录运行，使用 pnpm。

检查 git status、fetch、比较远端；遵循仓库同步规范。不要提交、推送、修改线上主题，除非另获授权。不要打印或向聊天粘贴 .env 和 token。

当前工作流复用场景叠加机制：普通场景 scene-room-v1，大尺寸场景 scene-room-large-v1（须先验证线上主题已支持，否则只准备本地素材，不能上传空背景冒充完成）。不实现新版场景 metafield，不调用旧 create-product.js，不运行历史迁移。文末响应式 6–7 图是本技能新任务的素材规范，不批量更改旧商品。

## 任务入口与恢复

运行 `node scripts/ochre-workflow.js --help`。新建 `init <task-id>`；继续任务先 `status <task-id>`，阅读任务文件和每个 pending/uncertain 操作。任务存储于 `.shopify/canvasra-workflow/<task-id>/`。

同一任务只允许一个 Codex 会话负责外部操作。脚本的锁只保护本地写入；pending 日志跨命令阻止新的操作。崩溃留下锁时先确认没有运行中的写进程，不能直接删除重试。

任务状态和审核事实必须通过脚本记录，不凭聊天记忆推断，不伪造用户确认。不要直接手改 task.json 绕过阻断。

## 1. 参考图与主图

店主已长期确认：凡其提供的图片均已获商业授权，记录此声明作为 rightsEvidence，不再逐图询问。确认忠实提取 extract 或参考创作 create。多幅画先指定目标。复制参考图到任务：`import ID reference PATH reference`。

自主选择合适的六比例之一，保留重要内容，记录裁切/扩图依据。忠实提取优先确定性裁切和透视校正，缺失补绘明确披露。用本地配置的视觉/语言模型或 Codex 自身图片理解分析，不假设图片生成模型擅长结构化文案。

店主长期偏好（2026-09-07）：选择“保留原作／保持原作／extract”即包含自动清理水印、平台标识、账号文字和截图界面等外加干扰的授权，不再单独询问是否去水印或修复。保持原作主体、构图、配色与比例，只修补受遮挡区域，不因清理裁掉画作内容；属于画作本身的文字或签名保留。保留来源图和独立修复版本，记录修复范围及生成补绘；仍按既定操作日志执行，并将修复主图纳入正常素材审核。店主提供图片的商业授权按长期声明记录；图片正常展示，最终发布仍需审核。

将 spec JSON 写入任务目录，再运行 `spec ID PATH`，格式见 reference。生图方式保存为 spec.generation.provider：`codex` 或 `custom-api`（旧任务的 `openrouter` 继续兼容）。遵循用户选择；未指定时使用 Codex 内置生图。每次操作在 receipt 记录实际 provider，允许用户对单张素材切换方式，不混淆已生成版本的来源。具体步骤见 references/workflow.md 的“生图方式”。

Codex 模式使用当前会话内置 image_gen 工具，并遵循可用 imagegen 技能；不需要自定义 API 密钥，不承诺固定模型、尺寸或免费额度。自定义 API 使用 `scripts/ochre-generate.js`，先核对服务的请求/响应协议与参考图能力；现有脚本只支持文档列出的同步 JSON 协议。付费 API 请求使用已获得的次数/预算授权，无需重复询问已有授权；密钥仅从本地环境读取。两种方式均先记录操作、后保存产物与 receipt，结果不明不自动重试，不静默切换供应商。

导入主图 `import ID master PATH generated`，向用户展示实际图片，Codex 检查质量后直接 `accept ID VERSION "用户长期授权自动接受素材；本次质量检查依据"`，不再询问主图是否接受。主图变更会清空下游接受状态；不能重新接受旧主图的下游版本。

## 2. 自动肌理判断

店主长期偏好（2026-09-07）：肌理识别及是否制作侧面肌理图由 Codex 自行判断，不逐款询问肌理等级或“要不要做侧面图”。主图确认后记录 textureDecision 与 textureReason，并直接继续相应素材流程。

检查实际画面中的颜料堆积边缘、沟槽、遮挡关系及一致的局部高光/投影；笔触、色彩斑驳、画布纹理本身不等于立体肌理。判断侧面视角是否能补充正面细节图无法表达的起伏信息。立体线索清楚、侧面有展示价值且已有确认工艺支持时 include；平面效果、侧面无新增信息或依据不足时自行 omit，保留真实裁切细节图，不因素材取舍不确定而要求用户决定。

侧面肌理图是效果示意，不得写成实拍；生成时保持原作构图与配色，不凭空夸大厚度。图像无法证明真实厚度或可卷装性。自主素材判断不等于生产确认：若商品本身存在厚肌理与卷装等未解决制作交付冲突，保留生产阻断，仅确认具体制作事实；不能通过省略肌理图消除该冲突，也不设置 productionConfirmed=true。

已确认制作规则（2026-09-07，mineral-tides-create-20260907）：店主说明此类层叠肌理“不支持卷装，只做已确认可交付的绷框或浮框”。同类制作沿用此依据，自动排除 Rolled Canvas 以及模板中只有卷装的尺寸；不修改比例草稿或其他现有商品，不自行补出超大尺寸装框组合。不同工艺不自动套用此限制。

## 3. 三个场景和细节

新任务先执行 references/scene-lessons.md 的“光影预检与修复流程（2026-09-08）”：逐参考记录光源与适配计划，生成后按八项真实感和所有可售框色检查。不得把当前主题不支持的方向阴影写成已实现；背景问题定向修复，渲染问题停止自动重生。

每次任务在选图前阅读 [场景经验与视觉验收](references/scene-lessons.md)。它与文末最新场景约定优先于本文件旧方形尺寸示例。比例、遮挡检查与真实感检查必须分别通过，不能凭技术测试替代透视、光线和贴墙感验收。

细节必须来自已接受主图的真实裁切，使用 `scripts/ochre-crop.py`，将裁切 sidecar 和结果一起保存。导入 method=crop。不要用生成模型重新画细节。

每次场景生成前，必须读取本技能 `scene-library.json`，按 [场景图库选图规则](references/scene-library.md) 重新扫描固定目录及所有竞争对手子目录。Codex 根据已接受主图和候选图片的实际视觉内容自动选择三个合适参考，记录依据后生成；用户已授权自动挑选，不逐张请求选图确认。图库为空、缺失或没有合适候选时说明原因，不静默自由生成或复用历史场景。

三个场景不限定房间类型；可全部是客厅等同类空间，按画作适配优先选择，并通过布置、家具、材质或光线区分搭配效果。

店主长期要求：三个场景中至少一个必须展示大尺寸挂画效果，默认由 scene-3 承担，仍共三个场景。自动选择适合大画的参考，通过可信的家具比例、墙面留白和取景，让完整画作相对家具呈现明显的大幅尺度感；不能仅在文案标“大尺寸”或把整张图放大。大尺寸场景不能沿用普通 scene-room-v1 的小挂画区。使用经部署验证的独立大尺寸布局，完整画作在方形场景中长边约占65%–75%，2:3竖画宽约45%–50%；以画作占据主要墙面的近景构图验收，不能靠缩小家具或拉远房间冒充大尺寸。背景不烘焙画框、不裁切原作。最终叠加预览必须确认大画效果成立；不成立则调整背景并复验。此图为搭配示意，不标注未经真实比例校准的厘米尺寸，也不暗示不存在的尺寸或装裱组合。

三个场景都生成正面、方形空背景。普通场景挂画区为 left 23%, top 14%, width 54%, height 44%；大尺寸布局为 left 5%, top 0%, width 90%, height 84%。根据实际原作比例检查画作和家具不交叠，保留完整原作。背景不烘焙画或框。导入 scene-1/2/3，method=scene-room-v1 表示共同叠加机制；另在素材记录中注明普通或大尺寸布局及上传 alt。

检查实际图片：透视、留白、家具遮挡、同一画作。使用现有 frame-preview 和 artwork-scene 的渲染逻辑做组合预览，不仅展示空房间。浏览器验证和截图使用 agent-browser。若本机没有工具或 Shopify 预览认证，明确报告阻断，不假装看过效果。

提示词满足留白要求不等于生成结果合格：逐张检查完整挂画区，特别是沙发靠背、灯具和枝叶；遮挡时只修正问题区域或取景，保留旧版本并重新组合验收。审核页须使用主图真实宽高，并验证三个场景各八种装裱选项。截图前等待可见图片解码成功，检查画框材质实际加载；CSS 自定义属性中的相对 URL 可能相对样式表解析，本地审核使用可验证的资源 URL，不能把缺框或懒加载空白误判为素材问题。详见 references/scene-library.md。

主图、三个场景、缩略图和灯箱同步切换 Oak/Black/Walnut/White/Gold/Silver；Rolled/Stretched 无浮框。展示不按真实尺寸比例。旧 scene-room-v1 不动。场景图在 Shopify 原始媒体中仍是空房间，应向用户说明。

店主长期授权全自动素材流程：主图和后续素材由 Codex 检查、必要时修正，合格后直接运行 accept 并继续，不逐张索取确认。accept 证据引用长期授权和实际检查结果，不伪称用户逐张看过。无肌理输出 5 张，有肌理 6 张，顺序 master/detail/texture(可选)/scene-1/scene-2/scene-3。

## 4. 实时规则、定价和文案

2026-09-09 店主更新（优先于本节旧的基价、倍率、取整说明）：新商品按六比例实时草稿组合，以及 `data/pricing/mesonart-catalog.json` 精确尺寸、方向、框型的实际 USD 标价创建。规则为 Mesonart 2,000 款已采集样本的逐组合众数，不复制促销折扣、不插值、不取 .99；说明见 `docs/PRICE_TABLE.md`。卷装、绷框、Oak/Black/White/Gold/Silver 共七种标准装裱，Walnut 只保留历史兼容。店主已确认此次目录对应组合均可交付，取代旧目录 180 cm 门槛与此次商品旧交付限制；未来不同工艺仍须有实际依据，不能从图片推断。方形固定十档，其余比例分别读取价表，不复制对方混合比例下拉框。旧任务恢复先重读实时模板与精确价表，已创建商品不得重复创建。非零实际价格来自该价表；在售参照只用于真实组合、可售和库存规则核对。

读当前 Shopify 商店并验证主域名与币种和 `.env` 中 `SHOPIFY_STOREFRONT_HOST` / `SHOPIFY_CURRENCY` 配置一致；不是目标商店就停止。读取当前六比例草稿及指定定价参照商品。使用已安装 Shopify Admin 技能/官方文档核对支持的 API 版本与查询；不要复制过期 API 或固定资源 ID。允许只读核对，不因此写数据。

将完整读取证据保存到任务目录，导入 rules 文档。明确用户最小 Stretched USD 基价、每个尺寸倍率、卷装比例、各框加价与取整；冲突不平均猜测。保存完整 Size×Frame、非零 priceCents、来源 IDs 与确认记录到 pricing 文档。模板零价不能复制，生产冲突不能通过发明变体解决。

Size×Frame 组合取对应比例模板；非零价格及 inventoryPolicy、inventoryItem.tracked、requiresShipping 取本次实时读取且适用的在售参照，逐组合核对。参照冲突先查清，不盲目复制草稿模板的库存策略，也不硬编码 CONTINUE 或 tracked=false。库存跟踪开启不等于不可购买；发布前比对来源设置，发布后核对实际 available、默认 Oak、价格与加购目标。

英文文案描述题材、配色、搭配用途，工艺/运输/退换仅引用确认规则。没有销量依据不贴 best-seller；不造评论、作者或材料。协调画作分别出售必须写明单幅。导入 copy 文档。

## 5. 审核与发布

status 的 blockers 只是本地最低检查，不是 Shopify 完整验证。必须自行核对图片字节/比例/数量、裁切来源、全部精确组合、价表、文案、集合、发布目标、工艺与授权。

店主长期授权全自动商品工作流：用户提交图片并要求创建商品时，素材、文案、定价及发布前检查由 Codex 自动完成，不再设置逐阶段接受问题。对于授权范围内的本次商品，全部事实与检查齐备后以该长期授权和实际验收记录执行 `approve ID DIGEST EVIDENCE`，继续创建、回读及发布；不得伪称用户审阅了具体版本。若用户指定仅测试、仅素材或仅草稿，遵循该较窄范围。自动化不允许猜测价格、生产能力或绕过失败；确实缺少必要事实时说明具体缺口，继续可独立完成的部分。随后重新读规则；若变化影响内容，更新 documents 并重新自动验收。

外部执行使用 Codex 的 Shopify Admin 工具或项目 api.ps1；这里没有独立自动发布 CLI。先对每个写阶段 begin，再执行 API，保存安全 receipt 后 finish。具体恢复步骤见 reference。

校验和后续写入必须严格串行：先执行校验，确认成功后才发起下一阶段。禁止用分号连接校验、激活、发布命令；PowerShell 原生命令非零退出不一定抛异常，必须检查 $LASTEXITCODE。Python subprocess 使用 check=True 或显式检查 returncode。任何断言、API errors/userErrors、退出码或回读差异失败都停止后续写入；查明原因、修正并重新校验通过后才能恢复，不能因认为只是校验脚本问题而跳过。

先创建 DRAFT，并同时带唯一任务标记 `canvasra-task-<id>` 以便超时查询。发出创建前查询该标记；有一个就恢复其 ID，多于一个就停止核对。标记创建结果不明时保持 uncertain，不盲目再创建。确认后立即记录 productId。

只修改该任务商品：上传图片、等待 READY、设置实际变体/非零 USD 价格、集合归属，读取逐项核对。首图 alt=master；普通背景 alt=scene-room-v1，大尺寸背景 alt=scene-room-large-v1（上传前必须验证线上渲染支持），细节与肌理 alt 明确为 design detail/visualization。激活并发布 Online Store 是独立步骤，必须在所有检查完成后执行。

最后回读商品、媒体、全部变体、publication、集合，验证顾客链接与加购目标。只有真实验证成功才保存 published/readbackVerified。失败保留草稿，报告已成功的阶段及恢复入口。不得把 API 成功响应当作完整验收。

发布前记录目标 publication 和当前渠道，发布后分页读取全部 resourcePublications，报告实际渠道及自动新增渠道。店铺可能自动发布到 Microsoft Copilot 等渠道；历史表现不替代本次回读，不为处理单个商品擅自修改店铺全局渠道设置。若发布后才发现问题，记录实际 ACTIVE/发布状态及恢复入口，不误报为仍在草稿；结果未确认时不写 readbackVerified。

## 完成报告

报告任务 ID、接受版本、生成实际费用或未知、商品状态/链接、验证结果、阻断和备份位置。区分本地完成、已创建草稿、已发布、已验证线上；不要将计划或模拟称为已实现。

## 最新场景约定（2026-09-07，优先于旧方形条款）
新产品三个房间背景均按原生 3:4 创作。普通 alt=scene-room-v1，大尺寸 alt=scene-room-large-v1；大尺寸渲染已上线（fa6b5a2），挂画区 left10%、top0%、width80%、height78%。以完整叠加结果验收，方形画本次占场景宽约70%，上沿避开手机Header。根据原作方向和家具关系判断，不将旧方形长边指标直接套用。大尺寸参考优先从图库 bigsize/（大小写不敏感）专用文件夹选择，仍需每次扫描并看实际图片。普通背景保持各自构图；不得把画和框烘焙到空背景。

## 默认展示顺序（2026-09-07）
首页、分类页及推荐商品卡片始终优先使用 alt=master 的完整正面图。详情页有已验收的大尺寸场景时，顺序为大尺寸场景、master、其余素材（真实裁切细节、可选侧面肌理、另两个场景）；无大尺寸场景则回退 master。主题按标识独立排序，不通过改动 master 标识或仅交换 Shopify 媒体顺序实现。大尺寸首图必须通过 scene-lessons.md 的真实感验收；旧图存在已知视觉缺陷时不得将排序变更称为缺陷已修复。发布前验证卡片封面、详情首屏、缩略图、灯箱及换框时的当前图一致。

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


## PC Banner 制作与替换规则（2026-09-08，优先于上述旧PC条款）

新任务使用 `bannerProfile: fullbleed-v2`，按[完整Banner制作与验收契约](../../../docs/PRODUCT_BANNER_RULES.md)执行。原生21:9背景、独立v2挂画布局、全屏cover以及突破1920px页面上限必须配套；不要再沿用旧3:2小挂画区或超宽屏contain。该比例是本店适配方案，不冒称参考网站的图片比例。先计算实际画作占位，再生成背景；须检查四种屏幕和全部装裱的真实合成，视觉不通过不得上传。已有商品按版本保留，替换先备份。新版主题未部署时保留本地素材并明确阻断，不上传空背景。


## 作品驱动的场景设计（2026-09-08）

选图和生图前必须执行[作品与空间适配规则](../../../docs/ARTWORK_SCENE_DIRECTION.md)，保存逐作品、逐场景的设计依据。参考图只提供可取的摄影、光线和材质线索，不要求复制家具与布局；审美适配单独验收。
