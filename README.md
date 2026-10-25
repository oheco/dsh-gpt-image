# DSH GPT 图片生成与编辑

DSH Host 插件，向普通对话 Agent 提供两个工具，支持 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`：

| 工具 | 接口 | 用途 |
| --- | --- | --- |
| `generate_image` | `POST /v1/images/generations`，JSON | 根据文字生成新图，默认 Flare |
| `edit_image` | `POST /v1/images/edits`，multipart | 上传源图、修改要求和可选蒙版，默认 Sunburst |

例如在 DSH 中说：

> 用 Flare 生成一条蓝色大肥鱼，PNG。
>
> 再用 Sunburst 把刚才的鱼改成红色，保持构图和白色背景。

聊天模型负责理解需求、选择工具和整理提示词；图片模型通过工具调用。每张图片返回 DSH 预览和可下载原图。工具保留原始输出字节，预览遵守 DSH 的归一化策略。

## 安装和连接配置

需要 tools、attachments、credentials 服务；复用已有连接时还需 llm 和 settings。无需构建、npm install、MCP 或额外进程。运行时从当前 Host 导入框架包，兼容 ESM 命名空间和旧版 helper 的 CommonJS 直接导出。

1. 克隆并保留本仓库目录。
2. 在 DSH「插件」管理页从目录安装，例如本机 `/storage/Users/currentUser/dev/ohos/dsh-gpt-image`。
3. 默认复用 `codex-manager` 连接。需要换连接时修改 Cordis 配置中的 `provider`，例如本地 bundle 的[默认配置](cordis.patch.yml)，然后重新加载／安装并核对实际工具生效。
4. 在主对话或普通子 agent 对话中请求生成、编辑图片。

当前插件管理详情页只有开关和运行状态，**尚无可编辑的连接设置表单或下拉选择器**。`provider` 是 Cordis 配置项，填已有连接的标识；多个 profile 也可在自己的配置层覆盖。默认 bundle 为：

```yaml
- insert:
    - id: oheco-gpt-image
      name: './upload-host.js'
      config:
        provider: codex-manager
```

安装影响当前 profile 的会话。更新时运行中模块可能被缓存，应按管理器提示核对实际 Config、工具 schema 和调用结果，不能仅凭源码或版本清单判断新代码已加载。

## API 密钥如何选择

非空 `provider` 固定复用一条 DSH 连接，独立于主对话和子 agent 的聊天模型：

1. 在 DSH 连接目录精确查找唯一连接。
2. 从该连接的 settings 读取 `baseURL` 和 `apiKeyEnv`。
3. 每次调用使用 `credentials.resolve(credentialRef(apiKeyEnv))` 解析当前密钥，作为 API 请求的 Bearer 认证。

例如该连接引用 `CODEX_MANAGER_API_KEY`，就只解析这一项。多把 Key 不会触发轮询、故障回退或按图片模型切换；Flare 和 Sunburst 共用指定连接。主对话切换模型／连接也不会改变插件的选择。无效连接直接报错。

DSH 凭据服务先使用凭据库中的非空值，再使用环境变量、`.env` 等后备来源。插件不跨调用缓存密钥，更新对应凭据后下一次调用重新解析。工具参数和结果不含密钥。

复用连接要求 `openai-responses` 或 `openai-completions`、显式 `baseURL` 和 `apiKeyEnv`，且无自定义 HTTP 头。OAuth 连接需另行提供 Images API Key。聊天连接使用 Responses API 不会改变本工具的 Images API 路径。

将 `provider` 留空可使用独立地址和凭据引用。下面仅展示 `config` 值；非空 `provider` 优先于独立地址和凭据：

```yaml
provider: ''
baseURL: https://api.openai.com/v1
apiKeyEnv: OPENAI_API_KEY
defaultModel: gpt-image-2.5-flare
defaultEditModel: gpt-image-2.5-sunburst
maxImages: 4
maxInputMiB: 50
timeoutMs: 180000
maxResponseMiB: 128
```

通过 DSH 凭据设置保存 Key，不要写入仓库或 YAML。基础地址应含 `/v1`，插件追加 Images 路径。远程地址要求 HTTPS，只有 loopback 测试允许 HTTP。请求继承 DSH 启动代理和 TLS 设置，不修改全局网络配置。

## 参数和图片上传

| 参数 | 说明 |
| --- | --- |
| `prompt` | 必填，1–32000 个 Unicode 字符 |
| `model` | Flare 或 Sunburst；分别使用配置的生成／编辑默认值 |
| `n` | 默认 1，最多 `maxImages`；配置默认 4，可设 1–10 |
| `size` | `auto` 或 `宽x高`，例如 `1024x1024`、`1536x1024` |
| `quality` | `auto`、`low`、`medium`、`high`、`xhigh`、`max` |
| `output_format` | `png`、`jpeg`、`webp`，默认 PNG |
| `output_compression` | 0–100，仅在显式选择 JPEG/WebP 时设置 |
| `background` | `auto`、`opaque`、`transparent`；透明背景需要 PNG/WebP |

自定义尺寸要求宽高为 16 的倍数，每边不超过 3840，宽高比 1:3–3:1，总像素 655360–8294400。官方将高于 2560×1440 的生成标为实验性；实际行为仍受上游影响。

`edit_image` 必须提供 `images`：1–16 个完整 DSH 附件引用。

- 继续编辑生成结果：将最新结果的 `images[i].original` 原样传入，使用其 `attachmentId`、`name`、`bytes`，读取并上传原始字节。
- 已有 DSH 图片附件：可传完整的 `attachmentId`、`mediaType`、`bytes`、`width`、`height`，保留可选的 `name` 和 `originalDimensions`。此时上传 DSH 已归一化的图片字节。
- 源图接受 PNG/JPEG/WebP。原图和预览均通过 DSH 附件服务读取，不读取调用者给出的任意路径。
- 可选 `mask` 同样使用完整 DSH 附件引用，须为带 alpha 通道或 PNG 透明信息的 PNG，原始栅格尺寸与第一张源图匹配。透明区域表示需要修改的范围。
- 原图和蒙版在一次 multipart 请求中上传。已知输入总字节默认最多 50 MiB，包括蒙版；声明大小和实际读取大小都检查。完整性、图片解码、蒙版透明信息和尺寸检查在远程调用前完成。

蒙版是模型编辑引导，不保证其他像素完全不变，背景透明度也可能改变。若需要不透明输出，可显式指定 `background: opaque` 并在提示词中说明背景颜色；这仍不构成像素锁定。

连续编辑通过最新原图附件传回接口实现，不依赖插件内存中的游标。聊天模型从对话或子 agent 报告取得原图引用后即可再次读取持久化附件。本插件不管理 OpenAI 的 `previous_response_id`。

最终接口采用正常图片上传，不提供 URL、上游 File ID 或对话内 base64 输入，不需要对外开放图片服务器。

## Lead 和子 agent

Lead 可以创建普通对话子 agent，让其调用工具，通过 Team 消息追加修改要求或中断执行。子 agent 的主模型仍是支持工具调用的对话模型，Flare/Sunburst 是其选用的图片引擎，不注册为通用聊天模型或独立 LLM 路由。

结果包含有界 JSON 文本、图片块和原图文件块。每张图片的 JSON 含 `preview`、`original`，以及本地文件后端可用时的 `path`。子 agent 最终报告应包含原图引用和路径：DSH 的自动完成通知主要转发最终文本，不能依赖图片块自动转发给 Lead。

## 能力边界

已实现文生图、单图／多参考图编辑、连续改图、可选蒙版上传，以及表中的输出控制参数。蒙版适用于第一张源图，所有源图按原顺序提交。

未提供流式预览、Responses 原生会话链和 action 调度、`moderation` 参数、URL／上游 File ID 输入。审核采用上游默认值。参数校验和提交不等于保证每个网关完整实现官方行为。

每次请求可能计费；失败、超时或取消不自动重试。取消本地等待不能保证上游撤销已接受的工作或计费。原图和预览持久化在 DSH 附件存储，卸载插件不删除既有附件。输出接受规范 `data[].b64_json`，响应默认最多 128 MiB，错误响应单独限 64 KiB；usage 仅保留有界数值。

网关必须授权当前 Key 使用图片接口，模型目录可见不等于已授权。曾观测到请求 1024×1024 而返回 1254×1254 或 1536×1024；工具按实际字节保存，不重采样原图或伪造请求尺寸。

## 开发与验证

```sh
npm run check
npm test
npm pack --dry-run
DSH_RUNTIME_ENTRY=/absolute/path/to/dsh/lib/bin.js npm run test:native
```

核心测试仅使用 Node 标准库，不访问计费 API。[原生脚本](scripts/test-native.mjs)使用真实 Cordis Context、SystemPrompt、ToolRuntime 和 LocalAttachmentStore，HTTP 为有效 PNG fixture；验证生成、编辑、再次编辑和蒙版上传，临时存储在 `$TMPDIR` 创建并清理。真实网关及 Lead／子 agent 验证见[验证记录](VERIFICATION.md)。

官方资料：[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)、[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)、[Images API](https://developers.openai.com/api/reference/resources/images)、[图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)。

原创图标和代码采用 MIT 许可；GPT/OpenAI 名称用于说明 API 兼容性。
