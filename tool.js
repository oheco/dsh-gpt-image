import { randomUUID } from 'node:crypto';
import { generateImages, MODELS, QUALITIES } from './image-api.js';

export function createGenerateTool({ config, attachments, resolveConnection, signal: pluginSignal, fetchImpl }) {
  return {
    name: 'generate_image',
    description: 'Generate images from a text prompt with GPT Image. Returns visible image previews and downloadable original files. Calls the configured image API and may incur charges; failed calls are not retried automatically.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Describe the subject, composition, style, and any exact text to include; at most 32000 characters.' },
        model: { type: 'string', enum: MODELS, description: 'Optional model override; otherwise uses the configured default.' },
        n: { type: 'integer', description: 'Number of images, default 1; maximum is the configured limit (default 4, up to 10).' },
        size: { type: 'string', description: 'auto or WIDTHxHEIGHT, e.g. 1024x1024, 1536x1024. Sides must be multiples of 16, ≤3840; aspect ratio 1:3–3:1; total 655360–8294400 pixels.' },
        quality: { type: 'string', enum: QUALITIES, description: 'Optional image quality; provider default is auto.' },
        output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image encoding, default png.' },
        output_compression: { type: 'integer', description: '0–100; set only with jpeg or webp.' },
        background: { type: 'string', enum: ['auto', 'opaque', 'transparent'], description: 'Transparent backgrounds require png or webp.' },
      },
      required: ['prompt'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { model: { type: 'string' }, images: { type: 'array', items: { type: 'object' } }, usage: { type: 'object' } }, required: ['model', 'images'], additionalProperties: false },
      render(_args, value) {
        return [
          { type: 'text', text: JSON.stringify(value) },
          ...value.images.flatMap(image => [{ type: 'image', attachment: image.preview }, { type: 'file', attachment: image.original }]),
        ];
      },
    },
    // Include credential lookup and persistence in the timeout budget.
    timeoutMs: (config.timeoutMs ?? 180000) + 30000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const signal = pluginSignal ? AbortSignal.any([exec.signal, pluginSignal]) : exec.signal;
      signal.throwIfAborted();
      const connection = await resolveConnection();
      const result = await generateImages({ config: { ...config, baseURL: connection.baseURL }, args, apiKey: connection.apiKey, signal, fetchImpl });
      signal.throwIfAborted();
      const batch = randomUUID();
      const inputs = result.images.map((image, i) => ({ data: image.data, mediaType: image.mediaType, name: `${result.model}-${batch}-${i + 1}.${image.extension}` }));
      // Validate the whole batch before writing originals. DSH decodes the rasters.
      for (const input of inputs) { signal.throwIfAborted(); await attachments.validateImage(input); }
      const images = [];
      for (const input of inputs) {
        signal.throwIfAborted();
        const original = await attachments.saveFile({ data: input.data, name: input.name });
        signal.throwIfAborted();
        const preview = await attachments.saveImage(input);
        signal.throwIfAborted();
        const path = attachments.fileHostPath(original);
        images.push({ preview, original, ...(path ? { path } : {}) });
      }
      return { model: result.model, images, ...(result.usage ? { usage: result.usage } : {}) };
    },
  };
}
