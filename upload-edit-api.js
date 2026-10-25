import { ImageError } from './image-api.js';
import { editArguments, readEditInputs, createEditTransport } from './edit-api.js';
import { validateLocalMask } from './image-mask.js';

export function uploadArguments(args, config) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ImageError('INVALID_ARGUMENT', 'Expected an object.');
  const { mask, ...options } = args;
  const parsed = editArguments(options, config);
  if (mask === undefined) return parsed;
  const checked = editArguments({ prompt: 'Validate the mask reference.', images: [mask] }, config).references[0];
  const bytes = [...parsed.references, checked].reduce((sum, ref) => sum + ref.bytes, 0);
  if (bytes > (config.maxInputMiB ?? 50) * 1024 * 1024) throw new ImageError('INPUT_TOO_LARGE', 'Source images and mask exceed the configured total input byte limit.');
  return { ...parsed, mask: checked };
}

export async function readUploadInputs({ references, mask, attachments, config, signal }) {
  const all = await readEditInputs({ references: [...references, ...(mask ? [mask] : [])], attachments, config, signal });
  const images = all.slice(0, references.length);
  if (!mask) return { images };
  const imageMask = all.at(-1);
  await validateLocalMask({ mask: imageMask, image: images[0], attachments, signal });
  signal?.throwIfAborted();
  return { images, mask: imageMask };
}

// Keep source and mask bytes on the same authenticated multipart request.
export function createUploadTransport({ images, mask }, fetchImpl = globalThis.fetch) {
  return createEditTransport(images, (url, init) => {
    if (mask) init.body.set('mask', new Blob([mask.data], { type: mask.mediaType }), 'mask.png');
    return fetchImpl(url, init);
  });
}
