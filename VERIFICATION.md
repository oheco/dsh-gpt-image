# 验证记录

初次验证：2026-10-23；真实生图复验：2026-10-25（Asia/Shanghai）。环境：HarmonyOS aarch64、Node 24.21.0、DSH 0.2.1-rc.2-ohos.1。

## 本地检查

- `npm run check`：所有运行文件及原生集成脚本语法检查通过。
- `npm test`：59 项通过，0 失败、0 取消、0 跳过。覆盖两个模型的请求、参数与尺寸限制、2 MiB 分块图片响应、规范 base64、响应字节上限、错误脱敏、超时/取消、无自动重试、整批验证和附件输出。
- `npm run test:native`：使用安装版 DSH 的真实 Cordis Context、SystemPrompt、ToolRuntime、LocalAttachmentStore 和本插件入口。仅将 HTTP 响应替换为有效 PNG fixture，未调用远端服务。工具执行通过 DSH 参数、输出和内容校验；返回 text/image/file 内容块；原图文件字节一致，预览读取为 1×1；测试存储在 TMPDIR 创建并清理。
- `npm pack --dry-run`：检查运行文件、配置、bundle patch、中英文 locale、原创 SVG 图标、许可及文档的分发清单。无安装脚本、无下载的构建依赖。

## 当前 DSH profile

通过插件管理器从仓库目录安装到 `web` profile。首次导入暴露了链接目录无法直接解析 Host 包的问题，已通过当前 Host Node 入口定位依赖解决；没有修改 DSH 核心。

修复后 `Config.listConfigs` 可读取 `include:oheco-gpt-image` 的完整 schema，`Tool.listTools` 可见 `generate_image`，并在当前会话实际调用成功到达网关。插件管理页显示 `@oheco/dsh-gpt-image` 0.1.0、1 个组件运行中；中文标题、描述、bundle 和组件原创图标已实际查看。英文 locale 资源已检查，英文界面切换未实测。管理器的修复后启用操作曾返回 `restart-required / module-comparison`；随后以实际工具调用和界面运行状态确认了当前能力，而不是从该结果推断热加载成功。未重启用户的 DSH 进程。

## 真实 API

2026-10-23 初测复用现有 CodexManager 连接和 `CODEX_MANAGER_API_KEY` 凭据引用；密钥不输出、不复制到仓库。

1. `GET /v1/models` 返回 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。
2. 对每个模型各提交 1 张、1024×1024、low、PNG 的真实生成请求，均返回 `permission_error: Image generation is not enabled for this group`。
3. 安装后通过 DSH 的 `generate_image` 工具再次调用 Flare，返回 `Images API HTTP 403: Image generation is not enabled for this group`，确认连接读取、凭据解析、请求发送和错误反馈整条路径。

初测结论：插件和本机附件管线通过，真实生成因网关组权限失败。

### 2026-10-25 成功复验

经用户授权，在保留现有认证配置和 API Key 的情况下开启 Sub2API 目标分组的生图权限。未切换运行模式或重启服务；部署的数据库触发器自动提交每个 Key 的权限缓存失效任务，队列随后清空。

使用同一个凭据引用、插件生产入口、安装版 DSH 的真实 ToolRuntime 和 LocalAttachmentStore 运行两个真实请求。测试使用独立 Cordis Context；凭据解析器读取既有凭据，HTTP 通过 curl 适配现有 SOCKS5 代理并保持正常证书校验；这不是修改当前 profile，也不是 fixture 响应。

| 模型 | 用时 | PNG 原图字节 | 实际尺寸 | 原图 SHA-256 |
| --- | ---: | ---: | --- | --- |
| `gpt-image-2.5-flare` | 21.917 秒 | 2155074 | 1254×1254 | `6eda9b03e2a48aa93acbf3207e5ae66ed0abd756726b55078b3eff25e15ceba3` |
| `gpt-image-2.5-sunburst` | 21.677 秒 | 2174058 | 1254×1254 | `8044c558a9d781d21abcc2b9f5ac74d6a299f650768cc65661afc93e6f18f172` |

两次请求均为 `n=1`、`size=1024x1024`、`quality=low`、`output_format=png`。实际尺寸与请求不同是本次网关响应的观测结果；插件未重采样原图。工具均返回 text/image/file，保存原图成功，预览读取成功。两张图片已实际查看，均符合蓝色大肥鱼主题。每次报告 57 input tokens、515 output tokens、572 total tokens。

当前结论：两个指定模型的非流式 PNG 生图、真实 DSH 工具执行和附件保存已成功验证。管理员既有会话、现有 API Key 鉴权和相关认证数据在服务器变更后复验正常。

## 模型上下文开销

新增 1 个工具，无额外系统提示 section。序列化工具 schema 为 1441 字节。使用 DSH `TokenMeter.estimateMessage` 对空工具列表与新增该工具的文本进行同口径估算：5 → 363，增量约 358 tokens。该值是 DSH 启发式估算，未包含提供方对工具字段的独立封装，不等同于提供方精确计费 token。

## 边界

本版提供非流式文字生图，未实现图像编辑和部分图片流式预览。预览遵守 DSH 的图像存储限制，原图单独按原始字节保存。本次真实复验覆盖 PNG、low、单张生成；JPEG/WebP、透明背景、多张及其他质量档的参数校验有自动化覆盖，真实网关行为尚未逐项测试。独立 Host Context 的内容块和附件已验证，本次未另建 Web 聊天会话检查消息气泡。
