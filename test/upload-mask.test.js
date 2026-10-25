import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { uploadArguments, readUploadInputs, createUploadTransport } from '../upload-edit-api.js';
import { createUploadEditTool } from '../upload-edit-tool.js';

function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, 4, 'latin1');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function png({ width = 1, alpha = true, label = 'source' } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  // A complete scanline, filter zero, with transparent pixels for alpha masks.
  const pixels = Buffer.alloc(1 + width * (alpha ? 4 : 3));
  pixels[1] = 255;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from(`Comment\0${label}: preserve these original bytes`)),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND'),
  ]);
}
const SOURCE = png({ alpha: false });
const SECOND = png({ width: 2, label: 'second source' });
const MASK = png({ label: 'transparent mask' });
const OTHER_MASK = png({ label: 'different transparent mask' });
const RESULT = png({ label: 'provider result' });
const WEBP = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64');
const digest = data => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const fileRef = (data, name = 'source.png') => Object.freeze({ attachmentId: digest(data), name, bytes: data.byteLength });
const imageRef = (data, name = 'uploaded.png', mediaType = 'image/png') => Object.freeze({ ...fileRef(data, name), mediaType, width: mediaType === 'image/png' ? Buffer.from(data).readUInt32BE(16) : 1, height: 1 });
const ORIGINAL = fileRef(SOURCE);
const UPLOADED = imageRef(SECOND);
const MASK_REF = fileRef(MASK, 'mask.png');
const OTHER_MASK_REF = imageRef(OTHER_MASK, 'other-mask.png');
const SUNBURST = 'gpt-image-2.5-sunburst', FLARE = 'gpt-image-2.5-flare';
const KEY = 'sk-upload-mask-unit-test-secret';
const CONNECTION = { baseURL: 'https://image.example.test/proxy/v1', apiKey: KEY };
const CONFIG = { defaultModel: FLARE, timeoutMs: 2_000, maxImages: 4 };
const args = (images = [ORIGINAL], mask = MASK_REF) => ({ prompt: 'Change only the transparent mask region.', images, ...(mask === undefined ? {} : { mask }) });
const exec = signal => ({ signal: signal ?? new AbortController().signal });
const response = () => new Response(JSON.stringify({ data: [{ b64_json: RESULT.toString('base64') }], usage: { input_tokens: 5 } }));

// No production code path can make a live call during this test file.
test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { assert.fail('Unexpected global fetch.'); }));

function harness(options = {}) {
  const store = new Map([[ORIGINAL.attachmentId, SOURCE], [UPLOADED.attachmentId, SECOND], [MASK_REF.attachmentId, MASK], [OTHER_MASK_REF.attachmentId, OTHER_MASK]]);
  const reads = [], validations = [], imageSaves = [], originals = [], requests = [], events = [];
  let resolutions = 0;
  const verify = (ref, data) => {
    if (!data || digest(data) !== ref.attachmentId || data.byteLength !== ref.bytes) throw new Error('Stored attachment integrity failure.');
  };
  const attachments = {
    async *readFileStream(ref, signal) {
      reads.push({ kind: 'file', ref, signal });
      signal?.throwIfAborted();
      const data = store.get(ref.attachmentId);
      if (!data) throw new Error('Attachment is missing.');
      yield data.subarray(0, 5);
      yield data.subarray(5);
      verify(ref, data);
    },
    async readImage(ref, signal) {
      reads.push({ kind: 'image', ref, signal });
      signal?.throwIfAborted();
      const data = store.get(ref.attachmentId);
      verify(ref, data);
      return { ref, data };
    },
    async validateImage(input) { validations.push(input); events.push('validate'); },
    async saveImage(input) {
      imageSaves.push(input);
      events.push(`image:${input.name}`);
      const width = input.mediaType === 'image/png' ? Buffer.from(input.data).readUInt32BE(16) : 1;
      const ref = Object.freeze({ ...imageRef(RESULT, input.name), ...(width > 1 ? { originalDimensions: { width, height: 1 } } : {}) });
      store.set(ref.attachmentId, RESULT);
      return ref;
    },
    async saveFile(input) {
      const ref = fileRef(input.data, input.name);
      originals.push({ input, ref });
      events.push('file');
      store.set(ref.attachmentId, input.data);
      return ref;
    },
    readImageRequest() { assert.fail('Source bytes must not be resized for editing.'); },
    fileHostPath(ref) { return `/stored/${ref.name}`; },
  };
  const config = { ...CONFIG, ...options.config };
  const tool = createUploadEditTool({
    config, attachments, signal: options.pluginSignal,
    resolveConnection: async () => { events.push('resolve'); resolutions++; return CONNECTION; },
    fetchImpl: async (url, init) => {
      assert.equal(url, `${CONNECTION.baseURL}/images/edits`);
      assert.ok(init.body instanceof FormData, 'Every edit must upload binary multipart files.');
      requests.push({ url, init });
      events.push('fetch');
      return options.fetchImpl ? options.fetchImpl(url, init) : response();
    },
  });
  return { tool, config, attachments, store, reads, validations, imageSaves, originals, requests, events, get resolutions() { return resolutions; } };
}
const parts = async (form, field) => Promise.all(form.getAll(field).map(async file => Buffer.from(await file.arrayBuffer())));
function beforeHTTP(h) {
  assert.equal(h.requests.length, 0);
  assert.equal(h.resolutions, 0);
  assert.deepEqual(h.originals, []);
}

test('single/multi uploads retain exact originals and mask in one authenticated multipart request', async t => {
  for (const images of [[ORIGINAL], [ORIGINAL, UPLOADED]]) await t.test(`${images.length} image(s)`, async () => {
    const h = harness();
    const result = await h.tool.execute(args(images), exec());
    assert.equal(h.requests.length, 1);
    const { url, init } = h.requests[0];
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.get('authorization'), `Bearer ${KEY}`);
    assert.equal(init.headers.has('content-type'), false);
    const field = images.length === 1 ? 'image' : 'image[]';
    assert.deepEqual(await parts(init.body, field), images.length === 1 ? [SOURCE] : [SOURCE, SECOND]);
    assert.equal(init.body.has(images.length === 1 ? 'image[]' : 'image'), false);
    assert.deepEqual(await parts(init.body, 'mask'), [MASK]);
    assert.equal(init.body.get('mask').type, 'image/png');
    assert.equal(init.body.get('mask').name, 'mask.png');
    assert.equal(init.body.get('model'), SUNBURST);
    assert.equal(init.body.get('prompt'), args().prompt);
    assert.equal(init.body.has('images'), false);
    assert.deepEqual(h.reads.map(read => read.ref), [...images, MASK_REF]);
    assert.deepEqual(h.imageSaves.slice(0, 2).map(input => input.data), [MASK, SOURCE]);
    assert.ok(h.events.indexOf('resolve') > h.events.indexOf('image:edit-source-1'));
    const actual = new Request(url, init);
    assert.match(actual.headers.get('content-type'), /^multipart\/form-data; boundary=.+/);
    assert.deepEqual(await parts(await actual.formData(), 'mask'), [MASK]);
    assert.equal(result.images[0].original.attachmentId, digest(RESULT));
  });
});

test('omitting the optional mask keeps ordinary uploads free of mask reads and metadata probes', async () => {
  const h = harness();
  const input = { prompt: 'Edit the whole image.', images: [ORIGINAL] };
  await h.tool.execute(input, exec());
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.reads.map(read => read.ref), [ORIGINAL]);
  assert.deepEqual(await parts(h.requests[0].init.body, 'image'), [SOURCE]);
  assert.equal(h.requests[0].init.body.has('mask'), false);
  assert.equal(h.imageSaves.length, 1);
  assert.ok(h.imageSaves.every(saved => !saved.name.startsWith('edit-')));
});

test('the mask matches the first source even when subsequent source dimensions differ', async () => {
  const h = harness();
  await h.tool.execute(args([ORIGINAL, UPLOADED]), exec());
  assert.equal(h.requests.length, 1);
  const mismatch = harness();
  await assert.rejects(mismatch.tool.execute(args([UPLOADED, ORIGINAL]), exec()), { code: 'INVALID_MASK' });
  beforeHTTP(mismatch);
});

test('PNG masks may accompany a different source encoding without changing either file', async () => {
  const h = harness();
  const ref = fileRef(WEBP, 'source.webp');
  h.store.set(ref.attachmentId, WEBP);
  await h.tool.execute(args([ref]), exec());
  const form = h.requests[0].init.body;
  assert.equal(form.get('image').type, 'image/webp');
  assert.deepEqual(await parts(form, 'image'), [WEBP]);
  assert.deepEqual(await parts(form, 'mask'), [MASK]);
});

test('generation default does not override Sunburst edit default; configured/explicit choices reach multipart', async () => {
  assert.equal(uploadArguments(args(), CONFIG).body.model, SUNBURST);
  const h = harness({ config: { defaultEditModel: FLARE } });
  await h.tool.execute(args(), exec());
  assert.equal(h.requests[0].init.body.get('model'), FLARE);
  await h.tool.execute({ ...args(), model: SUNBURST, quality: 'high' }, exec());
  assert.equal(h.requests[1].init.body.get('model'), SUNBURST);
  assert.equal(h.requests[1].init.body.get('quality'), 'high');
});

test('URL and File ID sources and masks are rejected before any reads, credentials or HTTP', async t => {
  const refs = [
    { image_url: 'https://source.example.test/source.png' }, { file_id: 'file-existing_source' },
    'https://source.example.test/source.png', 'file-existing_source',
    { ...ORIGINAL, image_url: 'https://source.example.test/source.png' }, { ...MASK_REF, file_id: 'file-existing_mask' },
  ];
  for (const [index, ref] of refs.entries()) await t.test(`unsupported reference ${index + 1}`, async () => {
    for (const input of [args([ref]), args([ORIGINAL, ref]), args([ORIGINAL], ref)]) {
      const h = harness();
      await assert.rejects(h.tool.execute(input, exec()), { code: 'INVALID_ARGUMENT' });
      assert.deepEqual(h.reads, []);
      assert.deepEqual(h.imageSaves, []);
      beforeHTTP(h);
    }
  });
});

test('declared and actual source-plus-mask budgets stop before credentials or HTTP', async t => {
  const total = SOURCE.length + MASK.length;
  await t.test('declared aggregate', async () => {
    const h = harness({ config: { maxInputMiB: (total - 1) / 1024 ** 2 } });
    await assert.rejects(h.tool.execute(args(), exec()), { code: 'INPUT_TOO_LARGE' });
    assert.deepEqual(h.reads, []);
    beforeHTTP(h);
  });
  await t.test('actual bytes in mask stream', async () => {
    const h = harness({ config: { maxInputMiB: (total - 1) / 1024 ** 2 } });
    await assert.rejects(h.tool.execute(args([ORIGINAL], { ...MASK_REF, bytes: 1 }), exec()), { code: 'INPUT_TOO_LARGE' });
    assert.equal(h.reads.length, 2);
    assert.deepEqual(h.imageSaves, []);
    beforeHTTP(h);
  });
  await t.test('exact boundary accepted', async () => {
    const h = harness({ config: { maxInputMiB: total / 1024 ** 2 } });
    await h.tool.execute(args(), exec());
    assert.equal(h.requests.length, 1);
  });
});

test('invalid mask alpha, dimensions, storage integrity and metadata fail before HTTP', async t => {
  const opaqueMask = fileRef(SOURCE, 'opaque-mask.png');
  const wrongSize = fileRef(SECOND, 'wrong-size-mask.png');
  for (const [name, ref, setup, code] of [
    ['no alpha', opaqueMask, () => {}, 'INVALID_MASK'],
    ['wrong dimensions', wrongSize, () => {}, 'INVALID_MASK'],
    ['missing mask', MASK_REF, h => h.store.delete(MASK_REF.attachmentId), 'INPUT_READ_FAILED'],
    ['bad mask integrity', MASK_REF, h => h.store.set(MASK_REF.attachmentId, SOURCE), 'INPUT_READ_FAILED'],
    ['metadata failure', MASK_REF, h => { h.attachments.saveImage = async () => { throw new Error(`private ${KEY}`); }; }, 'INVALID_MASK'],
  ]) await t.test(name, async () => {
    const h = harness();
    setup(h);
    await assert.rejects(h.tool.execute(args([ORIGINAL], ref), exec()), error => { assert.equal(error.code, code); assert.ok(!error.message.includes(KEY)); return true; });
    beforeHTTP(h);
  });
});

test('transport preserves typed-array mask/source slices and leaves multipart boundary to fetch', async () => {
  const view = bytes => {
    const backing = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]);
    return new Uint8Array(backing.buffer, backing.byteOffset + 6, bytes.length);
  };
  const h = harness();
  const parsed = uploadArguments(args(), h.config);
  const resolved = await readUploadInputs({ ...parsed, attachments: h.attachments, config: h.config, signal: exec().signal });
  resolved.images[0].data = view(SOURCE);
  resolved.mask.data = view(MASK);
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Trace': 'mask-test' });
  const signal = exec().signal;
  let request;
  const transport = createUploadTransport(resolved, async (url, init) => { request = { url, init }; return response(); });
  await transport(`${CONNECTION.baseURL}/images/generations`, { method: 'POST', body: JSON.stringify(parsed.body), headers, signal });
  assert.deepEqual(await parts(request.init.body, 'image'), [SOURCE]);
  assert.deepEqual(await parts(request.init.body, 'mask'), [MASK]);
  assert.equal(request.init.headers.has('content-type'), false);
  assert.equal(request.init.headers.get('x-trace'), 'mask-test');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.strictEqual(request.init.signal, signal);
});

test('cancellation and plugin disposal during either metadata probe prevent credentials and HTTP', async t => {
  for (const source of ['execution', 'plugin']) for (const abortAt of [1, 2]) {
    await t.test(`${source}, probe ${abortAt}`, async () => {
      const controller = new AbortController(), reason = new Error('Stop during mask verification.');
      const h = harness({ pluginSignal: source === 'plugin' ? controller.signal : undefined });
      const saveImage = h.attachments.saveImage;
      h.attachments.saveImage = async input => {
        const ref = await saveImage(input);
        if (h.imageSaves.length === abortAt) controller.abort(reason);
        return ref;
      };
      await assert.rejects(h.tool.execute(args(), exec(source === 'execution' ? controller.signal : undefined)), error => error === reason);
      assert.equal(h.imageSaves.length, abortAt);
      beforeHTTP(h);
    });
  }
});

test('active multipart cancellation/disposal and upstream errors never retry or save output originals', async t => {
  for (const source of ['execution', 'plugin']) await t.test(source, async () => {
    const controller = new AbortController();
    let received;
    const h = harness({ pluginSignal: source === 'plugin' ? controller.signal : undefined, fetchImpl: async (_url, { signal }) => {
      received = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        queueMicrotask(() => controller.abort(new Error(KEY)));
      });
    } });
    await assert.rejects(h.tool.execute(args(), exec(source === 'execution' ? controller.signal : undefined)), { code: 'CANCELLED' });
    assert.equal(received.aborted, true);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.originals, []);
    assert.equal(h.imageSaves.length, 2);
  });
  await t.test('provider rejection', async () => {
    const h = harness({ fetchImpl: async () => new Response(JSON.stringify({ error: { message: `Rejected ${KEY}` } }), { status: 400 }) });
    await assert.rejects(h.tool.execute(args(), exec()), error => { assert.equal(error.code, 'API_ERROR'); assert.ok(!error.message.includes(KEY)); return true; });
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.originals, []);
    assert.equal(h.imageSaves.length, 2);
  });
});

test('concurrent uploads isolate each prompt, model, source list and mask bytes', { timeout: 3_000 }, async () => {
  const arrived = Promise.withResolvers(), release = Promise.withResolvers();
  let count = 0;
  const h = harness({ fetchImpl: async () => { if (++count === 2) arrived.resolve(); await release.promise; return response(); } });
  const first = h.tool.execute({ ...args(), prompt: 'first', model: FLARE }, exec());
  const second = h.tool.execute({ ...args([ORIGINAL, UPLOADED], OTHER_MASK_REF), prompt: 'second', model: SUNBURST }, exec());
  try {
    await arrived.promise;
    const forms = new Map(h.requests.map(request => [request.init.body.get('prompt'), request.init.body]));
    assert.deepEqual(await parts(forms.get('first'), 'image'), [SOURCE]);
    assert.deepEqual(await parts(forms.get('first'), 'mask'), [MASK]);
    assert.equal(forms.get('first').get('model'), FLARE);
    assert.deepEqual(await parts(forms.get('second'), 'image[]'), [SOURCE, SECOND]);
    assert.deepEqual(await parts(forms.get('second'), 'mask'), [OTHER_MASK]);
    assert.equal(forms.get('second').get('model'), SUNBURST);
  } finally { release.resolve(); }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.model), [FLARE, SUNBURST]);
  assert.notEqual(results[0].images[0].original.name, results[1].images[0].original.name);
  assert.equal(h.requests.length, 2);
});

test('masked outputs render durable files/images and latest originals remain reusable uploads', async () => {
  const h = harness();
  const result = await h.tool.execute(args(), exec());
  const rendered = h.tool.output.render(args(), result);
  assert.deepEqual(rendered.map(part => part.type), ['text', 'image', 'file']);
  assert.deepEqual(JSON.parse(rendered[0].text), result);
  assert.strictEqual(rendered[2].attachment, h.originals[0].ref);
  assert.equal(result.images[0].original.attachmentId, digest(RESULT));
  assert.deepEqual(h.originals[0].input.data, RESULT);
  assert.ok(!JSON.stringify(rendered).includes(KEY));
  await h.tool.execute(args([result.images[0].original]), exec());
  assert.deepEqual(await parts(h.requests[1].init.body, 'image'), [RESULT]);
  assert.deepEqual(await parts(h.requests[1].init.body, 'mask'), [MASK]);
});
