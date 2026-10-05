# Codex 商品流程与本地账本

这条流程由仓库 .agents/skills/canvasra-product/ 技能编排，状态保存在 .shopify/canvasra-workflow/。它与独立网页 [Product Studio](PRODUCT_STUDIO.md) 使用不同账本、适配器与能力边界，不能交叉套用任务 JSON。

## 当前边界

- pnpm canvasra 只做本地任务、素材版本、接受记录、规则文档与外部操作日志，不请求网络或自动发布。
- scripts/ochre-workflow.js 仍要求场景 method=scene-room-v1，保留 textureDecision / textureReason 字段；不支持直接导入完整场景并按 Studio 的 custom.scene_layouts 发布。
- mediaProfile=responsive-v1 增加 PC 槽位；无 profile 保留历史要求。修改主画会使关联素材失效，pending/uncertain 阻止继续写，已发布任务冻结。
- Codex 内置生图只能由会话工具调用，脚本不能独立调用。自定义 API 使用单独脚本，能力比 Studio 生图适配器窄。
- 素材验收与操作授权按用户请求、项目规则及实际技能执行；不把账本 approve 或 recorded receipt 当成真实 Shopify 回读。
- 六比例、实际变体、价格、生产与页面验证要求见[商品图规则](PRODUCT_IMAGE_RULES.md)。新增完整场景建议走已实现的 Studio；旧任务不自动迁移。

## 本地入口

```sh
pnpm canvasra --help
pnpm canvasra init limestone-study
pnpm canvasra status limestone-study
node scripts/ochre-generate.js --help
node scripts/ochre-scene-library.js
```

命令参数以 --help 和技能 references/workflow.md 为准。扫描参考库只产生清单，实际选图需看画面并记录理由；默认 scene-references/，三个场景至少一个大幅效果，不强制不同房间类型。

## 裁切依赖安装

隔离安装 Pillow，不修改系统 Python：

```sh
uv venv .shopify/canvasra-python
uv pip install --python .shopify/canvasra-python/Scripts/python.exe -r scripts/ochre-requirements.txt
```

Windows 使用 .shopify/canvasra-python/Scripts/python.exe；其他平台改为 .shopify/canvasra-python/bin/python。测试可用 CANVASRA_PYTHON 指定。ochre-crop.py 保存实际裁切和 SHA256 sidecar，导入 detail 时核对当前 master 来源。不得覆盖原图。

## 自定义 API

请求文件不存密钥：

```json
{
  "provider": "custom-api",
  "endpoint": "https://images.example.com/api/v1/images",
  "apiKeyEnv": "CANVASRA_IMAGE_API_KEY",
  "model": "your-image-model",
  "prompt": "已确定的生成要求",
  "resolution": "2K",
  "aspect_ratio": "4:3",
  "references": []
}
```

支持 HTTPS、Bearer、同步 JSON 请求与 data[0].media_type + b64_json 响应，最多三张本地参考。比例仅支持脚本列出的六种画作比例，当前不能直接生成 4:5 / 21:9；不具备 Studio 的 multipart 或 URL 图片下载能力。未指定 provider 保留旧 openrouter 行为，服务可用性需实际核对。

明确获相应付费请求授权后才执行：

```sh
node --env-file-if-exists=.env scripts/ochre-generate.js limestone-study master-1 .shopify/canvasra-workflow/limestone-study/request.json "本次生成授权依据"
```

脚本自行 begin/finish，不能重复登记相同操作。无自动重试；结果不明先核对计费与服务商结果。图片保存不等于验收通过，仍需 import/accept。未知费用保持未知。

## 发布与迁移

真实商品创建由已授权的 Admin 操作执行：读当前数据、备份、分阶段写入、保存商品 ID、回读媒体与变体和渠道。不等待商品数据产生主题同步提交。主题部署单独按[同步规范](SHOPIFY_GITHUB_WORKFLOW.md)。

原图、参考、失败版本、裁切证据、任务清单及备份保留在忽略目录；换电脑不能只拉 Git。模型凭据单独安全配置。
