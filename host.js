import { hostModule } from './runtime.js';
const { credentialRef } = await hostModule('@deepseek-ai/dsh-credentials');
import { Config } from './config.js';
import { createGenerateTool } from './tool.js';
import { ImageError, generationURL } from './image-api.js';
export { Config };
export const name = 'oheco-gpt-image';
export const inject = ['tools', 'attachments', 'credentials'];

export function apply(ctx, config = Config({})) {
  const controller = new AbortController();
  ctx.effect(() => () => controller.abort());
  const resolveConnection = async () => {
    let baseURL = config.baseURL, apiKeyEnv = config.apiKeyEnv;
    if (config.provider) {
      const llm = ctx.get('llm'), settings = ctx.get('settings');
      const directory = llm?.listConfigurableProviders().filter(item => item.provider === config.provider) ?? [];
      if (directory.length !== 1 || !settings) throw new ImageError('UNKNOWN_CONNECTION', 'The configured connection is unavailable. Use an existing API-key connection or configure a standalone Images API endpoint.');
      const entry = directory[0];
      let profile = settings.describe().find(item => item.ns === entry.settingsNs)?.value;
      for (const key of entry.settingsPath) profile = profile?.[key];
      if (!profile || !['openai-responses', 'openai-completions'].includes(profile.api) || !profile.apiKeyEnv || !profile.baseURL) {
        throw new ImageError('UNSUPPORTED_CONNECTION', 'Reusing a connection requires an OpenAI-compatible API, an explicit baseURL, and an apiKeyEnv credential reference. OAuth connections need a separate Images API key.');
      }
      if (profile.headers && Object.keys(profile.headers).length) throw new ImageError('UNSUPPORTED_CONNECTION', 'This connection uses custom headers. Configure a standalone Images API endpoint for this plugin.');
      baseURL = profile.baseURL; apiKeyEnv = profile.apiKeyEnv;
    }
    generationURL(baseURL);
    const apiKey = (await ctx.credentials.resolve(credentialRef(apiKeyEnv)))?.value;
    return { baseURL, apiKey };
  };
  ctx.effect(() => ctx.tools.register(createGenerateTool({ config, attachments: ctx.attachments, resolveConnection, signal: controller.signal })));
}
