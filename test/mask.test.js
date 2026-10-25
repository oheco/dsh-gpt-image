import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { ImageError } from '../image-api.js';
import { validateLocalMask } from '../image-mask.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function chunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4, 4, 'latin1');
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(colorType = 6, { width = 2, height = 3, transparency } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const stride = 1 + width * CHANNELS[colorType];
  const raster = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < width; x++) {
      const pixel = row * stride + 1 + x * CHANNELS[colorType];
      if (colorType === 4 || colorType === 6) raster[pixel + CHANNELS[colorType] - 1] = x % 2 ? 255 : 0;
    }
  }
  return Buffer.concat([
    SIGNATURE, chunk('IHDR', header),
    ...(colorType === 3 ? [chunk('PLTE', Buffer.from([0, 0, 0]))] : []),
    ...(transparency ? [chunk('tRNS', transparency)] : []),
    chunk('tEXt', Buffer.from('Comment\0preserve exact mask metadata')),
    chunk('IDAT', deflateSync(raster)), chunk('IEND'),
  ]);
}
const input = data => Object.freeze({ data, mediaType: 'image/png', extension: 'png' });
const RGBA = input(png());
const RGB = input(png(2));
const dimensions = (width = 2, height = 3) => ({ width, height });
function metadataStore(...metadata) {
  const calls = [];
  return {
    calls,
    async saveImage(value) {
      calls.push(value);
      return metadata[calls.length - 1] ?? dimensions();
    },
  };
}
const invalidMask = message => error => {
  assert.ok(error instanceof ImageError);
  assert.equal(error.code, 'INVALID_MASK');
  assert.equal(error.message, message);
  return true;
};
const FORMAT_ERROR = 'Mask must contain valid PNG image bytes.';
const ALPHA_ERROR = 'Mask PNG must include an alpha channel or transparency.';
const DIMENSION_ERROR = 'Mask dimensions must match the first source image.';
const METADATA_ERROR = 'Unable to verify mask and source image dimensions.';

// Check the fixture encodings independently of the helper's alpha/container scan.
test('PNG fixtures have valid checksums, complete chunks and decodable rasters', () => {
  const variants = [
    [0, undefined], [2, undefined], [3, undefined], [4, undefined], [6, undefined],
    [0, Buffer.alloc(2)], [2, Buffer.alloc(6)], [3, Buffer.from([0])],
  ];
  for (const [colorType, transparency] of variants) {
    const data = png(colorType, { transparency });
    assert.deepEqual(data.subarray(0, 8), SIGNATURE);
    const compressed = [];
    let offset = 8, finalType;
    while (offset < data.length) {
      const length = data.readUInt32BE(offset);
      const payload = data.subarray(offset + 4, offset + 8 + length);
      assert.equal(crc32(payload), data.readUInt32BE(offset + 8 + length));
      finalType = payload.toString('latin1', 0, 4);
      if (finalType === 'IDAT') compressed.push(payload.subarray(4));
      offset += length + 12;
    }
    assert.equal(offset, data.length);
    assert.equal(finalType, 'IEND');
    const raster = inflateSync(Buffer.concat(compressed));
    const stride = 1 + 2 * CHANNELS[colorType];
    assert.equal(raster.length, stride * 3);
    for (let row = 0; row < 3; row++) assert.equal(raster[row * stride], 0);
  }
});

test('RGBA and grayscale-alpha masks preserve exact buffers and metadata bytes', async t => {
  for (const colorType of [4, 6]) await t.test(`PNG color type ${colorType}`, async () => {
    const mask = input(png(colorType));
    const before = Buffer.from(mask.data), sourceBefore = Buffer.from(RGB.data);
    const attachments = metadataStore();
    assert.equal(await validateLocalMask({ mask, image: RGB, attachments }), undefined);
    assert.equal(attachments.calls.length, 2);
    assert.strictEqual(attachments.calls[0].data, mask.data);
    assert.strictEqual(attachments.calls[1].data, RGB.data);
    assert.equal(attachments.calls[0].mediaType, 'image/png');
    assert.deepEqual(Object.keys(attachments.calls[0]).sort(), ['data', 'mediaType', 'name']);
    assert.deepEqual(mask.data, before);
    assert.deepEqual(RGB.data, sourceBefore);
  });
});

test('grayscale, RGB and indexed PNG tRNS transparency count as alpha', async t => {
  for (const [colorType, transparency] of [[0, Buffer.alloc(2)], [2, Buffer.alloc(6)], [3, Buffer.from([0])]]) {
    await t.test(`PNG color type ${colorType} with tRNS`, async () => {
      await validateLocalMask({ mask: input(png(colorType, { transparency })), image: RGB, attachments: metadataStore() });
    });
  }
});

test('PNG masks without alpha fail before metadata storage', async t => {
  for (const colorType of [0, 2, 3]) await t.test(`PNG color type ${colorType}`, async () => {
    const attachments = metadataStore();
    await assert.rejects(validateLocalMask({ mask: input(png(colorType)), image: RGB, attachments }), invalidMask(ALPHA_ERROR));
    assert.deepEqual(attachments.calls, []);
  });
});

test('malformed containers and non-PNG masks fail with a fixed safe format error', async t => {
  const overlong = Buffer.from(RGBA.data);
  overlong.writeUInt32BE(0xffffffff, 8);
  const header = RGBA.data.subarray(8, 33);
  const cases = [
    ['non-PNG declared media type', { ...RGBA, mediaType: 'image/jpeg' }],
    ['non-PNG signature', input(Buffer.from('private path /do/not/expose.png'))],
    ['truncated chunk header', input(RGBA.data.subarray(0, 15))],
    ['truncated chunk payload', input(RGBA.data.subarray(0, -1))],
    ['chunk length beyond remaining bytes', input(overlong)],
    ['missing IEND', input(RGBA.data.subarray(0, -12))],
    ['trailing bytes after IEND', input(Buffer.concat([RGBA.data, Buffer.from('private token')]))],
    ['missing IDAT', input(Buffer.concat([SIGNATURE, header, chunk('IEND')]))],
    ['nonempty IEND', input(Buffer.concat([RGBA.data.subarray(0, -12), chunk('IEND', Buffer.from([0]))]))],
    ['duplicate IHDR', input(Buffer.concat([SIGNATURE, header, RGBA.data.subarray(8)]))],
    ['tRNS after IDAT', input(Buffer.concat([RGB.data.subarray(0, -12), chunk('tRNS', Buffer.alloc(6)), chunk('IEND')]))],
    ['invalid RGB tRNS length', input(png(2, { transparency: Buffer.from([0]) }))],
  ];
  for (const [name, mask] of cases) await t.test(name, async () => {
    const attachments = metadataStore();
    await assert.rejects(validateLocalMask({ mask, image: RGB, attachments }), invalidMask(FORMAT_ERROR));
    assert.deepEqual(attachments.calls, []);
  });
});

test('dimension comparisons use originalDimensions when either or both images were normalized', async t => {
  const mask = input(png(6, { width: 8, height: 6 }));
  const image = input(png(2, { width: 8, height: 6 }));
  const original = dimensions(8, 6);
  const cases = [
    ['both normalized differently', { ...dimensions(2, 2), originalDimensions: original }, { ...dimensions(1, 1), originalDimensions: original }],
    ['mask normalized only', { ...dimensions(2, 2), originalDimensions: original }, original],
    ['source normalized only', original, { ...dimensions(1, 1), originalDimensions: original }],
    ['neither normalized', original, original],
  ];
  for (const [name, maskRef, imageRef] of cases) await t.test(name, async () => {
    await validateLocalMask({ mask, image, attachments: metadataStore(maskRef, imageRef) });
  });
});

test('width or height mismatches fail even when normalized preview dimensions match', async t => {
  for (const original of [dimensions(3, 3), dimensions(2, 4)]) await t.test(`${original.width}x${original.height}`, async () => {
    const attachments = metadataStore(dimensions(), { ...dimensions(), originalDimensions: original });
    await assert.rejects(validateLocalMask({ mask: RGBA, image: RGB, attachments }), invalidMask(DIMENSION_ERROR));
  });
});

test('a non-PNG first source is accepted and its original media type reaches saveImage', async () => {
  // Complete lossless 1x1 WebP; source decoding is the caller's responsibility.
  const source = Object.freeze({
    data: Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64'),
    mediaType: 'image/webp', extension: 'webp',
  });
  const attachments = metadataStore(dimensions(1, 1), dimensions(1, 1));
  await validateLocalMask({ mask: input(png(6, { width: 1, height: 1 })), image: source, attachments });
  assert.strictEqual(attachments.calls[1].data, source.data);
  assert.equal(attachments.calls[1].mediaType, 'image/webp');
});

test('a remote first source skips matching unknown dimensions and still validates the local mask', async () => {
  const attachments = metadataStore(dimensions(2, 3));
  await validateLocalMask({ mask: RGBA, image: undefined, attachments });
  assert.equal(attachments.calls.length, 1);
  assert.strictEqual(attachments.calls[0].data, RGBA.data);
  await assert.rejects(validateLocalMask({ mask: RGB, attachments }), invalidMask(ALPHA_ERROR));
  assert.equal(attachments.calls.length, 1);
});

test('typed-array slices retain their original view and exclude unrelated backing bytes', async () => {
  const backing = Buffer.concat([Buffer.from('prefix'), RGBA.data, Buffer.from('suffix')]);
  const data = new Uint8Array(backing.buffer, backing.byteOffset + 6, RGBA.data.length);
  const mask = input(data);
  const attachments = metadataStore();
  await validateLocalMask({ mask, image: RGB, attachments });
  assert.strictEqual(attachments.calls[0].data, data);
  assert.deepEqual(Buffer.from(data), RGBA.data);
});

test('missing, invalid or incomplete raster metadata fails with a fixed safe error', async t => {
  for (const metadata of [undefined, {}, dimensions(0, 3), dimensions(2, -1), dimensions(NaN, 3), dimensions(2.5, 3), { ...dimensions(), originalDimensions: {} }]) {
    await t.test(JSON.stringify(metadata) ?? 'undefined', async () => {
      await assert.rejects(validateLocalMask({ mask: RGBA, attachments: { async saveImage() { return metadata; } } }), invalidMask(METADATA_ERROR));
    });
  }
});

test('storage failures on either image expose only a fixed safe mask error', async t => {
  for (const failAt of [1, 2]) await t.test(`save ${failAt}`, async () => {
    let calls = 0;
    const attachments = { async saveImage() { if (++calls === failAt) throw new Error('private /path and token'); return dimensions(); } };
    await assert.rejects(validateLocalMask({ mask: RGBA, image: RGB, attachments }), invalidMask(METADATA_ERROR));
    assert.equal(calls, failAt);
  });
});

test('pre-existing cancellation preserves its reason and prevents metadata storage', async () => {
  const reason = new Error('Stop mask validation');
  const attachments = metadataStore();
  await assert.rejects(validateLocalMask({ mask: RGBA, image: RGB, attachments, signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.deepEqual(attachments.calls, []);
});

test('cancellation during either metadata await wins over successful or failed saves', async t => {
  for (const abortAt of [1, 2]) for (const rejectSave of [false, true]) {
    await t.test(`save ${abortAt}, ${rejectSave ? 'reject' : 'resolve'}`, async () => {
      const controller = new AbortController(), reason = new Error('Stop while obtaining dimensions');
      let calls = 0;
      const attachments = { async saveImage() {
        if (++calls === abortAt) {
          await Promise.resolve();
          controller.abort(reason);
          if (rejectSave) throw new Error('private storage error');
        }
        return dimensions();
      } };
      await assert.rejects(validateLocalMask({ mask: RGBA, image: RGB, attachments, signal: controller.signal }), error => error === reason);
      assert.equal(calls, abortAt);
    });
  }
});
