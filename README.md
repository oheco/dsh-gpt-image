# DSH GPT 图片生成

DSH Host 插件，向聊天 Agent 提供 `generate_image` 工具，调用 OpenAI 兼容的 `POST /v1/images/generations`。支持 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。

用户可以直接在 DSH 对话中说：

> 生成一张可爱的蓝色大肥鱼图片。

或指定：

> 用 gpt-image-2.5-sunburst 生成蓝色大肥鱼，1536x1024，PNG。

图片模型通过工具调用，聊天模型继续负责理解需求、调用工具和解读结果。每张图片返回 DSH 图片预览和可下载的原始文件；预览遵守 DSH 的尺寸归一化规则，原图保留 API 返回字节。

## 安装

需要带有 tools、attachments、credentials 服务的 DSH，使用现有连接时还需 llm 和 settings 服务。无需构建、npm install、MCP 服务或额外进程；运行时异步导入 DSH 的 `@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-credentials`，等待与 Host 并发的模块加载完成。目录链接安装时使用当前 Host 的 Node 入口定位依赖，无需在仓库内复制或下载 DSH 包。bundle 的相对 Host 入口按其 patch 所在目录解析。

1. 克隆本仓库，或使用已有本地目录。
2. 在 DSH 的「插件」管理页选择从本地目录安装，输入仓库的绝对路径。例如本机为 `/storage/Users/currentUser/dev/ohos/dsh-gpt-image`。
3. 开启「GPT 图片生成」。默认复用名为 `codex-manager` 的已有连接。
4. 在对话中请求生成图片，聊天模型会调用 `generate_image`。

安装到当前 profile 后对该 profile 的所有会话生效。插件目录是代码来源，安装后应保留。源码更新后通过插件管理页更新，并按 DSH 返回的提示重启以加载新的模块。

## 连接与凭据

默认 bundle 配置只有连接名称：

```yaml
- insert:
    - id: oheco-gpt-image
      name: './host.js'
      config:
        provider: codex-manager
```

每次请求从 DSH 的连接目录和 settings 读取对应的 `baseURL`、`apiKeyEnv`，再从 credentials 解析凭据。连接必须明确配置 `openai-responses` 或 `openai-completions`、`baseURL` 和 `apiKeyEnv`。不支持复用 OAuth 连接或带自定义 HTTP 头的连接。

也可以在 profile 的用户 patch 层覆盖该行，使用独立的 OpenAI 或兼容网关。在 profile 用户 patch 中配置插件，通过 DSH 凭据界面保存密钥；不要将密钥写入仓库：

```yaml
- id: oheco-gpt-image
  config:
    provider: ''
    baseURL: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    defaultModel: gpt-image-2.5-flare
    maxImages: 4
    timeoutMs: 180000
    maxResponseMiB: 128
```

基础地址必须包含 API 版本路径，例如 `https://gateway.example/v1`；插件追加 `/images/generations`。远程地址要求 HTTPS，loopback 测试地址允许 HTTP。普通 `fetch` 继承 DSH 的启动代理与 TLS 设置，插件不修改全局代理或证书校验。

## 工具参数

只有 `prompt` 必填。其余参数未指定时，除了模型和图片数量外均使用 API 默认值。

| 参数 | 说明 |
| --- | --- |
| `prompt` | 图片描述，1–32000 字符 |
| `model` | `gpt-image-2.5-flare` 或 `gpt-image-2.5-sunburst`；默认使用插件配置 |
| `n` | 默认 1，最多为配置的 `maxImages`；配置默认 4，可设置 1–10 |
| `size` | `auto` 或 `宽x高`，例如 `1024x1024`、`1536x1024` |
| `quality` | `auto`、`low`、`medium`、`high`、`xhigh`、`max` |
| `output_format` | `png`、`jpeg`、`webp`，API 默认 PNG |
| `output_compression` | 0–100，仅在显式选择 JPEG/WebP 时设置 |
| `background` | `auto`、`opaque`、`transparent`；透明背景需要 PNG/WebP |

自定义尺寸要求：宽高是 16 的倍数，每边不超过 3840，宽高比在 1:3 到 3:1 之间，总像素在 655360 到 8294400 之间。官方将高于 2560×1440 的生成标为实验性。

返回 JSON 包括 `model`、`images` 和可选 `usage`。每张图片包含 `preview` 图片附件引用、`original` 原始文件引用，以及文件后端可用时的 `path`。渲染结果还携带 image 和 file 内容块，因此不需要将 base64 写进对话文本。`usage` 仅保留有界的数值统计。

## 请求行为与限制

- 每次工具调用可能计费。插件不自动重试失败或超时请求，避免重复提交；取消本地等待不能保证服务端撤销任务或计费。
- 支持非流式文字生图。本版不提供参考图编辑、局部编辑、流式预览、远程图片 URL 下载或任意模型 ID。
- 接收规范的 `data[].b64_json`，按实际文件头识别 PNG/JPEG/WebP，再由 DSH 解码验证。预览限制由当前 DSH attachments 策略决定；API 解压后响应默认最多 128 MiB。
- 网关必须为当前 API Key 开启图片生成权限，且账户具备相应模型额度。模型出现在 `/models` 并不证明图片接口已授权。
- 原始文件和预览均存入 DSH 附件存储；卸载插件不会删除已有对话附件。

## 开发与验证

```sh
npm run check
npm test
npm pack --dry-run
```

核心测试只使用 Node 标准库，覆盖请求参数、响应解码、响应大小限制、错误脱敏、取消/超时、无自动重试，以及附件输出。不调用真实计费 API。

原生集成验证需要已安装的 DSH。指定其 JavaScript 入口（不是 shell 启动器），运行 `DSH_RUNTIME_ENTRY=/absolute/path/to/dsh/lib/bin.js npm run test:native`。脚本使用真实 DSH 工具执行器与附件存储、fixture HTTP 响应，在 `$TMPDIR` 创建并清理独立数据目录；无需启动第二个 Web 服务。详见 [验证记录](VERIFICATION.md)。

本机验证环境：HarmonyOS aarch64、Node 24.21.0、DSH 0.2.1-rc.2-ohos.1。2026-10-23 初测被网关组权限拒绝。2026-10-25 开启当前 Sub2API 分组的生图权限后，复用同一凭据，通过插件生产入口、真实 DSH ToolRuntime 和附件存储分别成功生成 Flare、Sunburst 图片，各约 22 秒，均返回 text/image/file 内容块并完成原图和预览读取。测试请求为 1024×1024、low、PNG，网关实际返回的图片均为 1254×1254，插件保留原始字节；请求尺寸与实际输出尺寸的差异属于本次网关观测结果，不能将模型目录可见等同于参数按官方规格执行。

模型、参数及尺寸依据：

- [Flare 官方模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [Sunburst 官方模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)

本插件原创图标和代码采用 MIT 许可；名称中的 GPT/OpenAI 用于说明 API 兼容性。
