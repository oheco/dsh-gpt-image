import { ImageError } from './image-api.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = message => { throw new ImageError('INVALID_MASK', message); };
const invalidPNG = () => invalid('Mask must contain valid PNG image bytes.');
const positive = value => Number.isSafeInteger(value) && value > 0;

// Inputs have already been decoded by attachments.validateImage. Inspect the
// PNG container for transparency without decoding or replacing its exact bytes.
function requirePNGAlpha(mask) {
  if (mask?.mediaType !== 'image/png' || !(mask.data instanceof Uint8Array)) invalidPNG();
  const data = Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength);
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) invalidPNG();
  let offset = 8, colorType, alpha = false, transparency = false, imageData = false, ended = false;
  while (offset < data.length) {
    if (data.length - offset < 12) invalidPNG();
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) invalidPNG();
    const type = data.toString('latin1', offset + 4, offset + 8);
    const end = offset + length + 12;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) invalidPNG();
      colorType = data[offset + 17];
      if (![0, 2, 3, 4, 6].includes(colorType)) invalidPNG();
      alpha = colorType === 4 || colorType === 6;
    } else if (type === 'IHDR') invalidPNG();
    if (type === 'tRNS') {
      if (transparency || imageData || !(
        (colorType === 0 && length === 2) ||
        (colorType === 2 && length === 6) ||
        (colorType === 3 && length >= 1 && length <= 256)
      )) invalidPNG();
      transparency = alpha = true;
    }
    if (type === 'IDAT') imageData = true;
    if (type === 'IEND') {
      if (length !== 0 || !imageData || end !== data.length) invalidPNG();
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended) invalidPNG();
  if (!alpha) invalid('Mask PNG must include an alpha channel or transparency.');
}

async function originalDimensions(image, name, attachments, signal) {
  signal?.throwIfAborted();
  let ref;
  try {
    ref = await attachments.saveImage({ data: image.data, mediaType: image.mediaType, name });
  } catch {
    signal?.throwIfAborted();
    invalid('Unable to verify mask and source image dimensions.');
  }
  signal?.throwIfAborted();
  const dimensions = ref?.originalDimensions ?? ref;
  if (!positive(dimensions?.width) || !positive(dimensions?.height)) {
    invalid('Unable to verify mask and source image dimensions.');
  }
  return dimensions;
}

export async function validateLocalMask({ mask, image, attachments, signal }) {
  signal?.throwIfAborted();
  requirePNGAlpha(mask);
  const maskDimensions = await originalDimensions(mask, 'edit-mask.png', attachments, signal);
  signal?.throwIfAborted();
  // A native remote first source has no local raster metadata to compare.
  if (!image) return;
  const imageDimensions = await originalDimensions(image, 'edit-source-1', attachments, signal);
  signal?.throwIfAborted();
  if (maskDimensions.width !== imageDimensions.width || maskDimensions.height !== imageDimensions.height) {
    invalid('Mask dimensions must match the first source image.');
  }
}
