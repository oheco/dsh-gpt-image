import { hostModule } from './runtime.js';
const schemaModule = await hostModule('@deepseek-ai/schemastery');
// Also accept the direct CommonJS value returned by an older live helper.
const Schema = schemaModule.default ?? schemaModule;
import { MODELS } from './image-api.js';
const label = (en, zh) => ({ en, zh });
export const Config = Schema.object({
  provider: Schema.string().default('').extra('description', label('Fixed API-key connection to reuse, independent of the current chat model; blank uses standalone settings', '固定复用的 API Key 连接名称，不随当前聊天模型变化；留空则使用下方独立配置')),
  baseURL: Schema.string().default('https://api.openai.com/v1').extra('description', label('Images API base URL (including /v1)', '图片 API 基础地址（含 /v1）')),
  apiKeyEnv: Schema.string().default('OPENAI_API_KEY').extra('role', 'credential-ref').extra('description', label('DSH credential reference for a standalone endpoint', '独立配置使用的 DSH 凭据引用名称')),
  defaultModel: Schema.union(MODELS.map(value => Schema.const(value))).default(MODELS[0]).extra('description', label('Default generation model', '默认生成模型')),
  defaultEditModel: Schema.union(MODELS.map(value => Schema.const(value))).default(MODELS[1]).extra('description', label('Default editing model', '默认编辑模型')),
  maxImages: Schema.number().min(1).max(10).step(1).default(4).extra('description', label('Maximum output images per call', '每次调用最多输出图片数')),
  maxInputMiB: Schema.number().min(1).max(128).step(1).default(50).extra('description', label('Maximum total source image bytes in MiB', '编辑源图的总字节上限（MiB）')),
  timeoutMs: Schema.number().min(1000).max(1200000).step(1).default(180000).extra('description', label('Request timeout in milliseconds', '请求超时（毫秒）')),
  maxResponseMiB: Schema.number().min(1).max(512).step(1).default(128).extra('description', label('Maximum decompressed API response in MiB', 'API 解压后响应上限（MiB）')),
});
