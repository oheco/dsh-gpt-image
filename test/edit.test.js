import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { editArguments, readEditInputs, createEditTransport } from '../edit-api.js';
import { createEditTool } from '../edit-tool.js';

// Complete 1×1 RGBA PNG. A valid ancillary chunk makes a second, distinct
// encoding of the same raster, so an accidental decode/re-encode loses bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const text = Buffer.from('tEXtComment\0keep exact source metadata');
const chunk = Buffer.alloc(text.length + 8);
chunk.writeUInt32BE(text.length - 4);
text.copy(chunk, 4);
chunk.writeUInt32BE(crc32(text), chunk.length - 4);
const PNG_WITH_METADATA = Buffer.concat([PNG.subarray(0, -12), chunk, PNG.subarray(-12)]);
const id = data => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const fileRef = (data, name = 'source.png') => Object.freeze({ attachmentId: id(data), bytes: data.byteLength, name });
const imageRef = data => Object.freeze({ ...fileRef(data, 'uploaded.png'), mediaType: 'image/png', width: 1, height: 1, originalDimensions: Object.freeze({ width: 1, height: 1 }) });
const ORIGINAL = fileRef(PNG_WITH_METADATA);
const UPLOADED = imageRef(PNG);
const FLARE = 'gpt-image-2.5-flare';
const SUNBURST = 'gpt-image-2.5-sunburst';
const KEY = 'sk-edit-test-only-secret';
const CONNECTION = { baseURL: 'https://edit.example.test/proxy/v1', apiKey: KEY };
const CONFIG = { defaultModel: FLARE, maxImages: 4, timeoutMs: 2_000 };
const args = images => ({ prompt: 'Preserve the pixel; change its background.', images });
const exec = signal => ({ signal: signal ?? new AbortController().signal });
const response = (n = 1) => new Response(JSON.stringify({ data: Array.from({ length: n }, () => ({ b64_json: PNG.toString('base64') })), usage: { input_tokens: 4 } }));

function harness(options = {}) {
  const store = new Map([[ORIGINAL.attachmentId, PNG_WITH_METADATA], [UPLOADED.attachmentId, PNG]]);
  const reads = [], validations = [], originals = [], previews = [], requests = [];
  let resolutions = 0;
  // DSH owns reference integrity verification. Stream integrity can fail after
  // yielding bytes; the tool must finish verification before making a request.
  const verify = (ref, data) => {
    if (!data || id(data) !== ref.attachmentId || data.byteLength !== ref.bytes) throw new Error('Attachment integrity check failed.');
  };
  const attachments = {
    async *readFileStream(ref, signal) {
      reads.push({ kind: 'file', ref, signal });
      signal?.throwIfAborted();
      const data = store.get(ref.attachmentId);
      if (!data) throw new Error('Attachment missing.');
      yield data.subarray(0, 5);
      signal?.throwIfAborted();
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
    async validateImage(input) { validations.push(input); },
    async saveFile(input) {
      const ref = fileRef(input.data, input.name);
      originals.push({ input, ref });
      store.set(ref.attachmentId, input.data);
      return ref;
    },
    async saveImage(input) {
      const ref = Object.freeze({ ...imageRef(PNG_WITH_METADATA), name: input.name });
      previews.push({ input, ref });
      store.set(ref.attachmentId, PNG_WITH_METADATA);
      return ref;
    },
    fileHostPath(ref) { return `/stored/${ref.name}`; },
  };
  const tool = createEditTool({
    config: { ...CONFIG, ...options.config }, attachments, signal: options.pluginSignal,
    resolveConnection: async () => { resolutions++; return CONNECTION; },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return options.fetchImpl ? options.fetchImpl(url, init) : response(Number(init.body.get('n')));
    },
  });
  return { tool, attachments, store, reads, validations, originals, previews, requests, get resolutions() { return resolutions; } };
}

async function sourceBytes(form, field = 'image') {
  return Promise.all(form.getAll(field).map(async part => Buffer.from(await part.arrayBuffer())));
}
function assertNoHTTP(h) {
  assert.equal(h.requests.length, 0);
  assert.equal(h.resolutions, 0);
  assert.equal(h.originals.length, 0);
  assert.equal(h.previews.length, 0);
}

test('PNG fixtures contain complete chunks, valid checksums and a decodable pixel', () => {
  for (const data of [PNG, PNG_WITH_METADATA]) {
    const compressed = [];
    let offset = 8, finalChunk;
    while (offset < data.length) {
      const length = data.readUInt32BE(offset);
      const typeAndData = data.subarray(offset + 4, offset + 8 + length);
      assert.equal(crc32(typeAndData), data.readUInt32BE(offset + 8 + length));
      finalChunk = typeAndData.toString('ascii', 0, 4);
      if (finalChunk === 'IDAT') compressed.push(typeAndData.subarray(4));
      offset += length + 12;
    }
    assert.equal(offset, data.length);
    assert.equal(finalChunk, 'IEND');
    assert.equal(inflateSync(Buffer.concat(compressed)).length, 5);
  }
});

test('original files stream exact source bytes into a single-image multipart edit', async () => {
  const h = harness();
  const result = await h.tool.execute({ ...args([ORIGINAL]), quality: 'high', n: 2 }, exec());
  assert.equal(h.requests.length, 1);
  const { url, init } = h.requests[0];
  assert.equal(url, `${CONNECTION.baseURL}/images/edits`);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.ok(init.body instanceof FormData);
  assert.equal(init.headers.get('authorization'), `Bearer ${KEY}`);
  assert.equal(init.headers.get('accept'), 'application/json');
  assert.equal(init.headers.has('content-type'), false);
  assert.deepEqual([...init.body.keys()].sort(), ['image', 'model', 'n', 'prompt', 'quality']);
  assert.equal(init.body.get('model'), SUNBURST);
  assert.equal(init.body.get('n'), '2');
  assert.equal(init.body.get('quality'), 'high');
  assert.equal(init.body.get('prompt'), args([]).prompt);
  assert.equal(init.body.get('image').type, 'image/png');
  assert.match(init.body.get('image').name, /\.png$/);
  assert.deepEqual(await sourceBytes(init.body), [PNG_WITH_METADATA]);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].kind, 'file');
  assert.strictEqual(h.reads[0].ref, ORIGINAL);
  assert.deepEqual(h.validations[0].data, PNG_WITH_METADATA);
  assert.equal(result.model, SUNBURST);
  assert.equal(result.images.length, 2);
});

test('uploaded image references and originals preserve order in multi-image multipart fields', async () => {
  const h = harness();
  await h.tool.execute({ ...args([UPLOADED, ORIGINAL]), model: FLARE, size: '1024x1024', output_format: 'webp', output_compression: 0, background: 'transparent' }, exec());
  const { init } = h.requests[0];
  assert.deepEqual(await sourceBytes(init.body, 'image[]'), [PNG, PNG_WITH_METADATA]);
  assert.equal(init.body.has('image'), false);
  assert.equal(init.body.get('model'), FLARE);
  assert.equal(init.body.get('output_compression'), '0');
  assert.equal(init.body.get('size'), '1024x1024');
  assert.equal(init.body.get('background'), 'transparent');
  assert.deepEqual(h.reads.map(read => read.kind), ['image', 'file']);
  assert.strictEqual(h.reads[0].ref, UPLOADED);
  assert.deepEqual(h.validations.slice(0, 2).map(input => input.data), [PNG, PNG_WITH_METADATA]);
});

test('edit defaults are independent of generation defaults and explicit models take priority', () => {
  assert.equal(editArguments(args([ORIGINAL]), CONFIG).body.model, SUNBURST);
  assert.equal(editArguments(args([ORIGINAL]), { ...CONFIG, defaultEditModel: FLARE }).body.model, FLARE);
  assert.equal(editArguments({ ...args([ORIGINAL]), model: SUNBURST }, { defaultEditModel: FLARE }).body.model, SUNBURST);
});

test('transport lets fetch supply its multipart boundary and preserves unrelated request options', async () => {
  let sent;
  const transport = createEditTransport([{ data: PNG, mediaType: 'image/png', extension: 'png' }], async (url, init) => { sent = { url, init }; return response(); });
  const signal = new AbortController().signal;
  const headers = new Headers({ 'cOnTeNt-TyPe': 'application/json', Authorization: 'Bearer fake', 'X-Request-ID': 'edit-1' });
  await transport(`${CONNECTION.baseURL}/images/generations`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'test', n: 1 }), signal, redirect: 'error' });
  assert.equal(sent.init.headers.has('content-type'), false);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(sent.init.headers.get('x-request-id'), 'edit-1');
  assert.strictEqual(sent.init.signal, signal);
  const request = new Request(sent.url, sent.init);
  assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=.+/);
  const decoded = await request.formData();
  assert.deepEqual(await sourceBytes(decoded), [PNG]);
  await assert.rejects(transport(`${CONNECTION.baseURL}/chat/completions`, { body: '{}' }), { code: 'INVALID_ENDPOINT' });
});

test('invalid references and options fail before reading attachments or resolving a connection', async t => {
  const cases = [
    ['missing images', { prompt: 'edit' }], ['empty images', args([])], ['too many images', args(Array(17).fill(ORIGINAL))],
    ['URL instead of reference', args(['https://example.test/source.png'])],
    ['path instead of reference', args([{ path: '/source.png' }])],
    ['extra reference field', args([{ ...ORIGINAL, url: 'https://example.test/source.png' }])],
    ['invalid digest', args([{ ...ORIGINAL, attachmentId: 'sha256:1234' }])],
    ['zero bytes', args([{ ...ORIGINAL, bytes: 0 }])],
    ['missing original filename', args([{ attachmentId: ORIGINAL.attachmentId, bytes: ORIGINAL.bytes }])],
    ['partial image reference', args([{ ...ORIGINAL, mediaType: 'image/png' }])],
    ['unsupported GIF', args([{ ...UPLOADED, mediaType: 'image/gif' }])],
    ['invalid original dimensions', args([{ ...UPLOADED, originalDimensions: { width: 0, height: 1 } }])],
    ['unsupported model', { ...args([ORIGINAL]), model: 'unknown-model' }],
    ['unknown edit option', { ...args([ORIGINAL]), unsupported: ORIGINAL }],
    ['invalid output combination', { ...args([ORIGINAL]), output_format: 'jpeg', background: 'transparent' }],
  ];
  for (const [name, input] of cases) await t.test(name, async () => {
    const h = harness();
    await assert.rejects(h.tool.execute(input, exec()), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual(h.reads, []);
    assertNoHTTP(h);
  });
});

test('declared aggregate input budget is checked before any source read', async () => {
  const h = harness({ config: { maxInputMiB: (ORIGINAL.bytes + UPLOADED.bytes - 1) / 1024 ** 2 } });
  await assert.rejects(h.tool.execute(args([ORIGINAL, UPLOADED]), exec()), { code: 'INPUT_TOO_LARGE' });
  assert.deepEqual(h.reads, []);
  assertNoHTTP(h);
});

test('actual streamed and image bytes cannot exceed the aggregate input budget', async t => {
  for (const kind of ['file', 'image']) await t.test(kind, async () => {
    const h = harness({ config: { maxInputMiB: (PNG.length + 1) / 1024 ** 2 } });
    const ref = kind === 'file' ? ORIGINAL : UPLOADED;
    const small = Object.freeze({ ...ref, bytes: 1 });
    if (kind === 'image') h.attachments.readImage = async () => ({ ref: small, data: PNG_WITH_METADATA });
    await assert.rejects(h.tool.execute(args([small]), exec()), { code: 'INPUT_TOO_LARGE' });
    assertNoHTTP(h);
  });
});

test('missing objects, digest failures, invalid formats and decoder rejection stop before HTTP', async t => {
  const cases = [
    ['missing object', ORIGINAL, h => h.store.delete(ORIGINAL.attachmentId), 'INPUT_READ_FAILED'],
    ['stream digest failure after bytes yielded', ORIGINAL, h => h.store.set(ORIGINAL.attachmentId, PNG), 'INPUT_READ_FAILED'],
    ['image digest failure', UPLOADED, h => h.store.set(UPLOADED.attachmentId, PNG_WITH_METADATA), 'INPUT_READ_FAILED'],
    ['unsupported file bytes', fileRef(Buffer.from('This is not an image.'), 'notes.txt'), (h, ref) => h.store.set(ref.attachmentId, Buffer.from('This is not an image.')), 'INVALID_INPUT_IMAGE'],
    ['media type mismatch', Object.freeze({ ...UPLOADED, mediaType: 'image/jpeg' }), () => {}, 'INVALID_INPUT_IMAGE'],
    ['decoder rejection', ORIGINAL, h => { h.attachments.validateImage = async () => { throw new Error(`Invalid raster ${KEY}`); }; }, 'INPUT_READ_FAILED'],
    ['byte count mismatch from backend', UPLOADED, h => { h.attachments.readImage = async () => ({ ref: UPLOADED, data: PNG_WITH_METADATA }); }, 'INVALID_INPUT_IMAGE'],
  ];
  for (const [name, ref, setup, code] of cases) await t.test(name, async () => {
    const h = harness();
    setup(h, ref);
    await assert.rejects(h.tool.execute(args([ref]), exec()), error => { assert.equal(error.code, code); assert.ok(!error.message.includes(KEY)); return true; });
    assertNoHTTP(h);
  });
});

test('read helper preserves typed-array slices without copying unrelated backing bytes', async () => {
  const backing = Buffer.concat([Buffer.from('prefix'), PNG, Buffer.from('suffix')]);
  const data = new Uint8Array(backing.buffer, backing.byteOffset + 6, PNG.length);
  const h = harness();
  h.attachments.readImage = async () => ({ ref: UPLOADED, data });
  const images = await readEditInputs({ references: [UPLOADED], attachments: h.attachments, config: CONFIG, signal: exec().signal });
  const transport = createEditTransport(images, async (_url, init) => { assert.deepEqual(await sourceBytes(init.body), [PNG]); return response(); });
  await transport(`${CONNECTION.baseURL}/images/generations`, { headers: {}, body: '{}' });
});

test('provider, transport and malformed response errors make exactly one request and save nothing', async t => {
  const cases = [
    ['HTTP error', async () => new Response(JSON.stringify({ error: { message: `Rejected ${KEY}\nrequest` } }), { status: 403 }), 'API_ERROR'],
    ['network failure', async () => { throw new Error(`network ${KEY}`); }, 'TRANSPORT_ERROR'],
    ['invalid JSON', async () => new Response('invalid JSON'), 'API_ERROR'],
    ['wrong image count', async () => new Response(JSON.stringify({ data: [] })), 'INVALID_RESPONSE'],
    ['invalid returned image', async () => new Response(JSON.stringify({ data: [{ b64_json: 'not base64' }] })), 'INVALID_IMAGE'],
  ];
  for (const [name, fetchImpl, code] of cases) await t.test(name, async () => {
    const h = harness({ fetchImpl });
    await assert.rejects(h.tool.execute(args([ORIGINAL]), exec()), error => { assert.equal(error.code, code); assert.ok(!error.message.includes(KEY)); return true; });
    assert.equal(h.requests.length, 1);
    assert.equal(h.originals.length, 0);
    assert.equal(h.previews.length, 0);
  });
});

test('execution cancellation and plugin disposal stop before reads or abort an active edit', async t => {
  for (const source of ['execution', 'plugin']) {
    await t.test(`${source}: already aborted`, async () => {
      const reason = new Error('Stopped before editing');
      const signal = AbortSignal.abort(reason);
      const h = harness({ pluginSignal: source === 'plugin' ? signal : undefined });
      await assert.rejects(h.tool.execute(args([ORIGINAL]), exec(source === 'execution' ? signal : undefined)), error => error === reason);
      assert.deepEqual(h.reads, []);
      assertNoHTTP(h);
    });
    await t.test(`${source}: during request`, async () => {
      const controller = new AbortController();
      let requestSignal;
      const h = harness({ pluginSignal: source === 'plugin' ? controller.signal : undefined, fetchImpl: async (_url, { signal }) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          queueMicrotask(() => controller.abort(new Error(KEY)));
        });
      } });
      await assert.rejects(h.tool.execute(args([ORIGINAL]), exec(source === 'execution' ? controller.signal : undefined)), error => { assert.equal(error.code, 'CANCELLED'); assert.ok(!error.message.includes(KEY)); return true; });
      assert.equal(requestSignal.aborted, true);
      assert.equal(h.requests.length, 1);
      assert.deepEqual(h.originals, []);
      assert.deepEqual(h.previews, []);
    });
  }
});

test('cancellation during a streamed source read stops before validation and HTTP', async () => {
  const controller = new AbortController();
  const reason = new Error('Stop reading sources');
  const h = harness();
  h.attachments.readFileStream = async function* (_ref, signal) {
    assert.strictEqual(signal, controller.signal);
    yield PNG_WITH_METADATA.subarray(0, 5);
    controller.abort(reason);
    yield PNG_WITH_METADATA.subarray(5);
  };
  await assert.rejects(h.tool.execute(args([ORIGINAL, UPLOADED]), exec(controller.signal)), error => error === reason);
  assert.deepEqual(h.validations, []);
  assertNoHTTP(h);
});

test('concurrent edit calls keep source bytes, prompt and chosen model isolated', async () => {
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  let waiting = 0;
  const h = harness({ fetchImpl: async () => { if (++waiting === 2) arrived.resolve(); await release.promise; return response(); } });
  const first = h.tool.execute({ ...args([ORIGINAL]), prompt: 'first edit', model: FLARE }, exec());
  const second = h.tool.execute({ ...args([UPLOADED]), prompt: 'second edit', model: SUNBURST }, exec());
  await arrived.promise;
  const byPrompt = new Map(h.requests.map(request => [request.init.body.get('prompt'), request.init.body]));
  assert.deepEqual(await sourceBytes(byPrompt.get('first edit')), [PNG_WITH_METADATA]);
  assert.deepEqual(await sourceBytes(byPrompt.get('second edit')), [PNG]);
  assert.equal(byPrompt.get('first edit').get('model'), FLARE);
  assert.equal(byPrompt.get('second edit').get('model'), SUNBURST);
  release.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.model), [FLARE, SUNBURST]);
  assert.notEqual(results[0].images[0].original.name, results[1].images[0].original.name);
  assert.equal(h.requests.length, 2);
});

test('results render durable JSON, image previews and exact downloadable originals usable in followup edits', async () => {
  const h = harness();
  const result = await h.tool.execute({ ...args([ORIGINAL]), n: 2 }, exec());
  assert.deepEqual(result.usage, { input_tokens: 4 });
  assert.equal(h.originals.length, 2);
  assert.equal(h.previews.length, 2);
  const rendered = h.tool.output.render(args([ORIGINAL]), result);
  assert.deepEqual(rendered.map(part => part.type), ['text', 'image', 'file', 'image', 'file']);
  assert.deepEqual(JSON.parse(rendered[0].text), result);
  for (let index = 0; index < result.images.length; index++) {
    assert.strictEqual(rendered[1 + index * 2].attachment, h.previews[index].ref);
    assert.strictEqual(rendered[2 + index * 2].attachment, h.originals[index].ref);
    assert.equal(result.images[index].original.attachmentId, id(PNG));
    assert.deepEqual(h.originals[index].input.data, PNG);
    assert.equal(result.images[index].path, `/stored/${result.images[index].original.name}`);
  }
  assert.ok(!JSON.stringify(rendered).includes(KEY));
  await h.tool.execute(args([result.images[0].original]), exec());
  assert.deepEqual(await sourceBytes(h.requests[1].init.body), [PNG]);
});
