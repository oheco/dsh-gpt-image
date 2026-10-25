import { ImageError, requestBody } from './image-api.js';

export const MAX_INPUT_IMAGES = 16;
const invalid = message => { throw new ImageError('INVALID_ARGUMENT', message); };
const fields = new Set(['attachmentId', 'name', 'bytes', 'mediaType', 'width', 'height', 'originalDimensions']);
const positive = value => Number.isSafeInteger(value) && value > 0;
const limitBytes = config => (config.maxInputMiB ?? 50) * 1024 * 1024;

export function editArguments(args, config) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('Expected an object.');
  const { images, ...options } = args;
  const body = requestBody(options, { ...config, defaultModel: config.defaultEditModel ?? 'gpt-image-2.5-sunburst' });
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_INPUT_IMAGES) invalid('images must contain 1–16 DSH attachment references.');
  let declaredBytes = 0;
  for (const ref of images) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some(key => !fields.has(key))) invalid('Use an unmodified DSH image or original file attachment reference.');
    if (typeof ref.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId) || !positive(ref.bytes)) invalid('Each image needs a valid attachmentId and positive byte count.');
    if (ref.name !== undefined && (typeof ref.name !== 'string' || !ref.name.length || ref.name.length > 1024)) invalid('Invalid attachment filename.');
    const imageRef = ref.mediaType !== undefined || ref.width !== undefined || ref.height !== undefined || ref.originalDimensions !== undefined;
    if (imageRef) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(ref.mediaType) || !positive(ref.width) || !positive(ref.height)) invalid('Image references need PNG/JPEG/WebP mediaType, width and height.');
      if (ref.originalDimensions !== undefined && (!ref.originalDimensions || typeof ref.originalDimensions !== 'object' || Array.isArray(ref.originalDimensions) || Object.keys(ref.originalDimensions).some(key => !['width', 'height'].includes(key)) || !positive(ref.originalDimensions.width) || !positive(ref.originalDimensions.height))) invalid('Invalid originalDimensions.');
    } else if (typeof ref.name !== 'string' || !ref.name.length) invalid('Original file references need their recorded filename.');
    declaredBytes += ref.bytes;
    if (declaredBytes > limitBytes(config)) throw new ImageError('INPUT_TOO_LARGE', 'Source images exceed the configured total input byte limit.');
  }
  return { body, references: images };
}

function identify(data) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mediaType: 'image/png', extension: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mediaType: 'image/jpeg', extension: 'jpg' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { mediaType: 'image/webp', extension: 'webp' };
  throw new ImageError('INVALID_INPUT_IMAGE', 'Source attachments must contain PNG, JPEG or WebP image bytes.');
}

export async function readEditInputs({ references, attachments, config, signal }) {
  const images = [];
  let total = 0;
  for (const ref of references) {
    signal?.throwIfAborted();
    let data;
    try {
      if (ref.mediaType !== undefined) {
        const stored = await attachments.readImage(ref, signal);
        data = stored.data;
        total += data.byteLength;
        if (total > limitBytes(config)) throw new ImageError('INPUT_TOO_LARGE', 'Source images exceed the configured total input byte limit.');
      } else {
        const chunks = [];
        let size = 0;
        for await (const chunk of attachments.readFileStream(ref, signal)) {
          signal?.throwIfAborted();
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (total > limitBytes(config)) throw new ImageError('INPUT_TOO_LARGE', 'Source images exceed the configured total input byte limit.');
          chunks.push(chunk);
        }
        data = Buffer.concat(chunks, size);
      }
      signal?.throwIfAborted();
      if (data.byteLength !== ref.bytes) throw new ImageError('INVALID_INPUT_IMAGE', 'Source attachment byte count does not match its reference.');
      const format = identify(data);
      if (ref.mediaType !== undefined && ref.mediaType !== format.mediaType) throw new ImageError('INVALID_INPUT_IMAGE', 'Source attachment media type does not match its bytes.');
      const image = { data, ...format };
      await attachments.validateImage({ data, mediaType: format.mediaType, name: `input-${images.length + 1}.${format.extension}` });
      signal?.throwIfAborted();
      images.push(image);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ImageError) throw error;
      throw new ImageError('INPUT_READ_FAILED', 'Unable to read and verify a source image. Reuse its complete DSH attachment reference.');
    }
  }
  return images;
}

// Edits share the generation client's bounded response parser, cancellation,
// redaction and single-attempt policy. Only endpoint and wire encoding differ.
export function createEditTransport(images, fetchImpl = globalThis.fetch) {
  return async (url, init) => {
    const endpoint = new URL(url);
    if (!endpoint.pathname.endsWith('/images/generations')) throw new ImageError('INVALID_ENDPOINT', 'Unexpected Images API endpoint.');
    endpoint.pathname = endpoint.pathname.slice(0, -'generations'.length) + 'edits';
    const form = new FormData();
    for (const [key, value] of Object.entries(JSON.parse(init.body))) form.set(key, String(value));
    const field = images.length === 1 ? 'image' : 'image[]';
    for (const [index, image] of images.entries()) form.append(field, new Blob([image.data], { type: image.mediaType }), `input-${index + 1}.${image.extension}`);
    const headers = new Headers(init.headers);
    headers.delete('content-type');
    return fetchImpl(endpoint.href, { ...init, headers, body: form });
  };
}
