import { createGenerateTool } from './tool.js';
import { uploadArguments, readUploadInputs, createUploadTransport } from './upload-edit-api.js';

const attachment = {
  type: 'object',
  properties: {
    attachmentId: { type: 'string' }, bytes: { type: 'integer' }, name: { type: 'string' },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
    width: { type: 'integer' }, height: { type: 'integer' },
    originalDimensions: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } }, required: ['width', 'height'], additionalProperties: false },
  },
  required: ['attachmentId', 'bytes'], additionalProperties: false,
};

export function createUploadEditTool(options) {
  const base = createGenerateTool(options);
  return {
    ...base,
    name: 'edit_image',
    description: 'Edit or combine images with GPT Image using uploaded source attachments and an optional PNG alpha mask. Returns previews and original files. Calls the configured image API and may incur charges; failures are not retried automatically.',
    parameters: {
      ...base.parameters,
      properties: {
        ...base.parameters.properties,
        model: { ...base.parameters.properties.model, description: 'Optional override; otherwise uses the configured edit model (default Sunburst).' },
        images: { type: 'array', minItems: 1, maxItems: 16, items: attachment, description: '1–16 complete DSH source attachments. For lossless followup edits copy images[].original from the newest result. Complete uploaded/read image refs also work. Original bytes are uploaded to the Images edit API.' },
        mask: { ...attachment, description: 'Optional PNG alpha mask attachment matching the first source image dimensions. Transparent regions indicate where to edit; other pixels may still change. Uploaded with the original image bytes.' },
      },
      required: ['prompt', 'images'],
    },
    async execute(args, exec) {
      const signal = options.signal ? AbortSignal.any([exec.signal, options.signal]) : exec.signal;
      signal.throwIfAborted();
      const parsed = uploadArguments(args, options.config);
      const inputs = await readUploadInputs({ ...parsed, attachments: options.attachments, config: options.config, signal });
      signal.throwIfAborted();
      const operation = createGenerateTool({ ...options, signal: undefined, fetchImpl: createUploadTransport(inputs, options.fetchImpl) });
      return operation.execute(parsed.body, { ...exec, signal });
    },
  };
}
