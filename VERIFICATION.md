# 验证记录

## 0.3.0 — 图片附件与蒙版上传

日期：2026-10-25（Asia/Shanghai）。环境：HarmonyOS aarch64、Node 24.21.0、DSH 0.2.1-rc.2-ohos.1。范围是两个 Images 工具，不注册图片模型 LLM 路由；源图和蒙版通过 DSH 附件读取并正常上传。

### 自动化与原生集成

- `npm run check`：全部生产模块、兼容入口和原生脚本语法通过。
- `npm pack --dry-run --json`：23 个打包文件，全部 15 个运行时 JS 模块及 21 条相对导入／转发边均被包含，未生成归档；独立只读代码复核及 `git diff --check` 无阻塞问题。
- `npm test`：198 项通过，0 失败、0 取消、0 跳过。使用有效 PNG/JPEG/WebP fixture 和 Node 标准库，不访问真实网关。
- 原生脚本使用安装态真实 Cordis Context、SystemPrompt、ToolRuntime、LocalAttachmentStore 和凭据服务，HTTP 返回有效 PNG fixture。
- 原生链路依次执行生成、Sunburst 编辑、Flare 继续编辑和源图＋蒙版编辑，共 4 次请求，均返回 text/image/file 块；原图落盘字节与 fixture 完全一致。
- 原生实际注册工具只有 `generate_image`、`edit_image`；最终编辑 schema 有蒙版，没有 URL／File ID 分支。

原生摘要：

```json
{"verified":true,"requests":4,"tools":["generate_image","edit_image"],"content":["text","image","file"],"originalBytes":70,"preview":"1x1","maskedMultipart":true,"attachmentOnly":true,"fixture":true}
```

回归覆盖源图顺序、原始字节、归一化引用、multipart 自动 boundary、编辑默认模型与显式覆盖、源图＋蒙版声明／实际总量上限、存储完整性、PNG alpha／透明信息、原始尺寸、取消／卸载、并发隔离、错误脱敏和单次请求策略。URL、File ID、字符串路径及混合伪引用在读图、解析凭据和 HTTP 前拒绝。

### 真实网关与 Lead 控制

连接固定为 `codex-manager`，凭据引用 `CODEX_MANAGER_API_KEY`，通过 DSH credentials 服务解析。没有切换聊天主模型、扫描其他 Key 或改动服务器／容器。

Lead 创建普通对话成员 `image-studio`（主模型 GPT-6.1-Sol），完成后再次唤醒同一成员，下发修改要求。真实工具调用结果如下；各调用均明确 n=1、low quality，失败不自动重试。

| 步骤 | 工具／图片引擎 | 验证结果 |
| --- | --- | --- |
| 文生图 | generate_image / Sunburst | 蓝鱼、黑色星星，1254×1254，1187821 字节 |
| Lead 追加改色 | edit_image / Flare | 上传前一步原图，鱼改红、黑色星星保留，1254×1254，1565596 字节 |
| 蒙版编辑，自动背景 | edit_image / Sunburst | 上传红鱼和透明选区 PNG，星星改黄；上游同时改变背景透明度 |
| 最终仅上传接口，指定 opaque | edit_image / Sunburst | 同一原图和蒙版再次上传，星星为金黄，红鱼和白底可见；最终 schema 无远程引用 |

前三张原图 SHA-256：

- 生成蓝鱼：`ae133d3ebc32be98b4f2a6b0db163aeaf70a0cefe9783a62186e08dfdbe44963`
- 改色红鱼：`1abff0e72d4d740b449cf2eab17f6d8fabdbbb04f344f5abf0bc22b20d63f60e`
- 自动背景蒙版结果：`bd55d6870e0be82e1c0cf37bc229f8620502ccbe3f3b0f149e83b008db411f4e`

最终 opaque 蒙版结果经 Lead 再次读图确认：1254×1254、1129541 字节；PNG 为 8-bit RGB（color type 2），无 alpha 通道和 tRNS，背景确为不透明。SHA-256 `b452fd55e32c8841430425a4f6afc647d66adf1add8781799b50da895cd0e422`。API usage 为输入 1583、输出 915、总计 2498 tokens。图片均返回完整 original／preview 引用和持久化文件路径，可继续上传编辑。

蒙版原图为 1254×1254 RGBA PNG，9842 字节，SHA-256 `e6451596a60b32ef1424dbf71d9ea284d23706c16df49a87deeab7cf0924c4e6`，只有星星附近矩形区域透明。自动背景结果的 PNG alpha 检查确认角点 RGBA 为 `[0,0,0,0]`，透明像素 1223405；因此不能把“蒙版请求成功”解读成蒙版外像素被锁定。工具保存上游原图，不擅自合成或修正背景。

### 运行态与安装

最终安装目录为本仓库，bundle 版本 0.3.0，Host 入口为 [upload-host.js](upload-host.js)。保留早期入口作为兼容转发，避免运行中旧 ESM 缓存影响新入口的验证；[配置模块](image-config.js)同时接受 ESM namespace 和旧 helper 直接返回的 CommonJS Schema。

管理器的包操作成功，仍返回 `application: restart-required`、`restartReason: module-comparison`。该返回值未记作 `applied`。本次没有重启 DSH，而是用实际 Config／工具 schema、正常子 agent 的最终蒙版调用核对新入口已运行，当前对话继续可用。后续重启应由用户安排并遵循管理器提示。

独立 UI 核验确认插件 v0.3.0、插件与组件开关均开启，显示“共 1 个 · 1 运行中”，组件为 upload-host.js；原创蓝色／青色景观星光图标正常显示。检查后已恢复原空白草稿和原活动浏览器标签。插件详情页的连接设置目前没有表单，只有安装信息、开关和运行状态。连接选择在 Cordis 配置的 `provider`；实际 Key 按该连接的 `apiKeyEnv` 每次解析。无 Key 轮换、静默回退、跟随当前聊天连接或额外凭据缓存。

### 模型上下文增量

使用真实 DSH TokenMeter 的纯 `estimateMessage` 方法，将相同 JSON schema 文本放入相同 user 消息外壳比较：

| schema 集合 | JSON 字节数 | DSH 估算 tokens |
| --- | ---: | ---: |
| 原有 generate_image | 1443 | 367 |
| 最终 generate_image + edit_image（附件／蒙版） | 4400 | 1104 |
| 增量 | 2957 | 737 |

这仅为工具 schema 的同口径启发式估算，不是提供方精确计费或整个首轮请求的 token 数。未增加常驻系统提示。源图二进制不会作为工具参数中的 base64 进入对话。

### 限制

- 官方蒙版是提示引导，不承诺形状、边界或其他像素完全不变；背景参数亦由上游执行。
- 参数校验和提交不等于网关完整实现；请求 1024×1024 的真实样本返回过 1254×1254 或 1536×1024，保存实际尺寸和字节。
- 不提供流式预览、Responses 原生会话链／action、moderation 选择、URL／上游 File ID 输入。所有编辑输入正常上传，不需要图片托管服务。
- 实际验证覆盖两模型生成／编辑、连续编辑和蒙版上传；未逐一对所有尺寸、质量、批量、压缩及透明背景组合进行计费实测。
- 取消本地请求不保证撤销上游已接受的任务或计费。没有对真实计费任务做故意中断测试，取消和卸载路径由自动化 fixture 覆盖。

## 0.1.1 历史基线

已提交基线 `329812576c7a94af32511af707a59e1f68a95f72` 修复 Host ESM 并发导入及插件激活。当时仅有生成工具，61 项测试通过；两图片模型均完成真实生成和原图下载验证。0.3.0 在该基线上保留生成客户端、响应界限、脱敏、原图持久化和取消语义，扩展附件编辑与蒙版。
