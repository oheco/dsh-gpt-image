import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  ImageError, MODELS, decodeImage, generateImages, generationURL, readLimited, requestBody,
} from '../image-api.js';

// A complete 1×1 RGBA PNG, with valid chunk checksums and a zlib-compressed scanline.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const API_KEY = 'sk-unit-test-secret-never-send';
const CONFIG = {
  baseURL: 'https://images.example.test/v1', timeoutMs: 2_000, maxImages: 4, maxResponseMiB: 8,
};
const ARGS = { prompt: 'A red pixel.' };
const payload = (n = 1) => ({ data: Array.from({ length: n }, () => ({ b64_json: PNG_BASE64 })) });
const jsonResponse = (value, init) => new Response(JSON.stringify(value), init);
const invoke = options => generateImages({
  config: CONFIG, args: ARGS, apiKey: API_KEY,
  fetchImpl: async () => jsonResponse(payload()), ...options,
});
const hasCode = code => error => {
  assert.ok(error instanceof ImageError);
  assert.equal(error.code, code);
  assert.ok(!error.message.includes(API_KEY));
  return true;
};

function chunkedResponse(text, chunkSize = 16_384) {
  const bytes = Buffer.from(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }));
}

// Add a valid ancillary PNG chunk so the large fixture is still a decodable image.
function largePNG(commentBytes) {
  const text = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(commentBytes, 65)]);
  const type = Buffer.from('tEXt');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(text.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, text])));
  return Buffer.concat([PNG.subarray(0, -12), length, type, text, checksum, PNG.subarray(-12)]);
}

// Keep one ref'ed timer until abort: AbortSignal.timeout alone does not keep Node alive.
function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      reject(new Error('The request did not receive an abort signal.'));
    }, 1_000);
    function abort() {
      clearTimeout(guard);
      reject(signal.reason);
    }
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('generationURL appends the endpoint and permits HTTP only on loopback', () => {
  assert.equal(generationURL('https://images.example.test/v1/'), 'https://images.example.test/v1/images/generations');
  assert.equal(generationURL('https://images.example.test/prefix/v1///'), 'https://images.example.test/prefix/v1/images/generations');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(generationURL(`http://${host}:1234/v1`), `http://${host}:1234/v1/images/generations`);
  }
  for (const url of ['/v1', 'ftp://images.example.test/v1', 'http://images.example.test/v1',
    'https://user:password@images.example.test/v1', 'https://images.example.test/v1?key=secret',
    'https://images.example.test/v1#fragment']) {
    assert.throws(() => generationURL(url), hasCode('INVALID_ENDPOINT'), url);
  }
});

test('both models send exactly one authenticated JSON request with provider options', async t => {
  assert.deepEqual(MODELS, ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  for (const model of MODELS) {
    await t.test(model, async () => {
      let calls = 0;
      const args = {
        prompt: '保留文字 🌅', model, n: 2, size: '1536x1024', quality: 'xhigh',
        output_format: 'webp', output_compression: 83, background: 'transparent',
      };
      const result = await invoke({ args, fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, 'https://images.example.test/v1/images/generations');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(options.headers, {
          Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json',
        });
        assert.deepEqual(JSON.parse(options.body), args);
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        assert.ok(!options.body.includes(API_KEY));
        return jsonResponse(payload(2));
      } });
      assert.equal(calls, 1);
      assert.equal(result.model, model);
      assert.equal(result.images.length, 2);
      for (const image of result.images) {
        assert.deepEqual(image, { data: PNG, mediaType: 'image/png', extension: 'png' });
      }
    });
  }
});

test('request defaults use configured model and omit unspecified provider options', () => {
  assert.deepEqual(requestBody(ARGS, {}), { model: MODELS[0], ...ARGS, n: 1 });
  assert.deepEqual(requestBody(ARGS, { defaultModel: MODELS[1] }), { model: MODELS[1], ...ARGS, n: 1 });
  assert.equal(requestBody({ ...ARGS, model: MODELS[0] }, { defaultModel: MODELS[1] }).model, MODELS[0]);
});

test('prompt validation counts Unicode code points, rejects unknown fields and malformed arguments', () => {
  assert.equal(requestBody({ prompt: '🌅'.repeat(32_000) }, CONFIG).prompt.length, 64_000);
  assert.equal(requestBody({ prompt: '  keep whitespace  ' }, CONFIG).prompt, '  keep whitespace  ');
  for (const args of [undefined, null, [], 'text', {}, { prompt: 123 }, { prompt: ' \n\t' },
    { prompt: '🌅'.repeat(32_001) }, { ...ARGS, extra: true }, { ...ARGS, model: 'gpt-image-1' }]) {
    assert.throws(() => requestBody(args, CONFIG), hasCode('INVALID_ARGUMENT'));
  }
});

test('n is an integer within the configured batch limit', () => {
  for (const n of [1, 4]) assert.equal(requestBody({ ...ARGS, n }, CONFIG).n, n);
  assert.equal(requestBody({ ...ARGS, n: 10 }, { maxImages: 10 }).n, 10);
  for (const n of [0, -1, 1.5, '2', NaN, Infinity, 5]) {
    assert.throws(() => requestBody({ ...ARGS, n }, CONFIG), hasCode('INVALID_ARGUMENT'));
  }
  assert.throws(() => requestBody({ ...ARGS, n: 3 }, { maxImages: 2 }), hasCode('INVALID_ARGUMENT'));
});

test('size accepts area/aspect boundaries and rejects invalid dimensions', () => {
  for (const size of ['auto', '1024x1024', '1280x512', '1536x512', '512x1536', '3840x2160']) {
    assert.equal(requestBody({ ...ARGS, size }, CONFIG).size, size);
  }
  for (const size of ['1024X1024', '1024×1024', '1024x1024 ', '1000x1024', '800x800',
    '4096x1024', '3840x2176', '512x1792', '1792x512', '0x1024', 1024, null]) {
    assert.throws(() => requestBody({ ...ARGS, size }, CONFIG), hasCode('INVALID_ARGUMENT'), String(size));
  }
});

test('format, quality, background and compression constraints are enforced', () => {
  for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(requestBody({ ...ARGS, quality }, CONFIG).quality, quality);
  }
  for (const output_format of ['png', 'jpeg', 'webp']) {
    assert.equal(requestBody({ ...ARGS, output_format }, CONFIG).output_format, output_format);
  }
  for (const output_format of ['jpeg', 'webp']) {
    for (const output_compression of [0, 100]) {
      assert.equal(requestBody({ ...ARGS, output_format, output_compression }, CONFIG).output_compression, output_compression);
    }
  }
  for (const output_format of ['png', 'webp']) {
    assert.equal(requestBody({ ...ARGS, output_format, background: 'transparent' }, CONFIG).background, 'transparent');
  }
  for (const options of [
    { quality: 'ultra' }, { quality: null }, { output_format: 'jpg' }, { background: 'clear' },
    { background: 'transparent', output_format: 'jpeg' }, { output_compression: 50 },
    { output_format: 'png', output_compression: 50 },
    ...[-1, 101, 1.5, '80', NaN].map(output_compression => ({ output_format: 'jpeg', output_compression })),
  ]) assert.throws(() => requestBody({ ...ARGS, ...options }, CONFIG), hasCode('INVALID_ARGUMENT'));
});

test('invalid arguments, endpoint and credentials fail before any request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Fetch must not run.'); };
  await assert.rejects(invoke({ args: { ...ARGS, n: 0 }, fetchImpl }), hasCode('INVALID_ARGUMENT'));
  await assert.rejects(invoke({ config: { ...CONFIG, baseURL: 'http://remote.example/v1' }, fetchImpl }), hasCode('INVALID_ENDPOINT'));
  for (const apiKey of [undefined, null, '', ' ', 'key with space', 'key\nsecret', '密钥']) {
    await assert.rejects(invoke({ apiKey, fetchImpl }), hasCode('MISSING_CREDENTIAL'));
  }
  assert.equal(calls, 0);
});

test('decodeImage accepts canonical base64 and rejects padding, whitespace and invalid image bytes', () => {
  assert.deepEqual(decodeImage(PNG_BASE64), { data: PNG, mediaType: 'image/png', extension: 'png' });
  const noncanonicalPaddingBits = `${PNG_BASE64.slice(0, -3)}h==`;
  assert.deepEqual(Buffer.from(noncanonicalPaddingBits, 'base64'), PNG);
  for (const value of [null, 42, '', PNG_BASE64.slice(0, -2), `${PNG_BASE64}\n`,
    ` ${PNG_BASE64}`, PNG_BASE64.replace('/', '_'), `data:image/png;base64,${PNG_BASE64}`,
    noncanonicalPaddingBits, '====', 'Zg==', Buffer.from('not an image').toString('base64')]) {
    assert.throws(() => decodeImage(value), hasCode('INVALID_IMAGE'));
  }
});

test('multi-megabyte canonical image data survives a chunked response without Content-Length', async () => {
  const image = largePNG(2 * 1024 * 1024);
  const result = await invoke({ fetchImpl: async () => chunkedResponse(JSON.stringify({
    data: [{ b64_json: image.toString('base64') }],
  })) });
  assert.equal(result.images[0].data.length, image.length);
  assert.deepEqual(result.images[0].data, image);
});

test('usage returns only bounded nonnegative numeric metadata, never provider text', async () => {
  const result = await invoke({ fetchImpl: async () => jsonResponse({ ...payload(), usage: {
    input_tokens: 12, output_tokens: 20, total_tokens: 32,
    input_tokens_details: { image_tokens: 9, text_tokens: 3, hidden: { count: 2, too_deep: { count: 99 } } },
    secret: API_KEY, invalid: -1, array: [1, 2], 'Bad-Key': 4,
  } }) });
  assert.deepEqual(result.usage, {
    input_tokens: 12, output_tokens: 20, total_tokens: 32,
    input_tokens_details: { image_tokens: 9, text_tokens: 3, hidden: { count: 2 } },
  });
  assert.ok(!JSON.stringify(result).includes(API_KEY));
});

test('HTTP and provider errors redact every key occurrence, normalize controls and never retry', async t => {
  for (const status of [400, 401, 429, 500, 200]) {
    await t.test(`HTTP ${status}`, async () => {
      let calls = 0;
      await assert.rejects(invoke({ fetchImpl: async () => {
        calls++;
        return jsonResponse({ error: { message: `Rejected ${API_KEY}\nagain\r${API_KEY}\tgroup unavailable` } }, { status });
      } }), error => {
        hasCode('API_ERROR')(error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.equal(error.message.split('[redacted]').length - 1, 2);
        assert.ok(!/[\r\n\t]/.test(error.message));
        return true;
      });
      assert.equal(calls, 1);
    });
  }
  await assert.rejects(invoke({ fetchImpl: async () => jsonResponse({
    error: { message: 'x'.repeat(2_000) },
  }, { status: 403 }) }), error => {
    hasCode('API_ERROR')(error);
    assert.equal(error.message, `Images API HTTP 403: ${'x'.repeat(500)}`);
    return true;
  });
});

test('non-JSON, malformed image counts and transport failures produce safe errors without retrying', async t => {
  const cases = [
    ['non-JSON success', () => new Response(`bad ${API_KEY}`), 'API_ERROR'],
    ['non-JSON failure', () => new Response(`bad ${API_KEY}`, { status: 502 }), 'API_ERROR'],
    ['missing error message', () => jsonResponse({ error: {} }, { status: 400 }), 'API_ERROR'],
    ['missing data', () => jsonResponse({}), 'INVALID_RESPONSE'],
    ['no images', () => jsonResponse(payload(0)), 'INVALID_RESPONSE'],
    ['extra images', () => jsonResponse(payload(2)), 'INVALID_RESPONSE'],
    ['URL instead of base64', () => jsonResponse({ data: [{ url: `https://example.test/${API_KEY}` }] }), 'INVALID_IMAGE'],
    ['invalid base64', () => jsonResponse({ data: [{ b64_json: 'AAAA' }] }), 'INVALID_IMAGE'],
    ['transport', () => { throw new Error(`Connection failed ${API_KEY}`); }, 'TRANSPORT_ERROR'],
  ];
  for (const [name, response, code] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      await assert.rejects(invoke({ fetchImpl: async () => { calls++; return response(); } }), hasCode(code));
      assert.equal(calls, 1);
    });
  }
  await assert.rejects(invoke({ args: { ...ARGS, n: 2 } }), hasCode('INVALID_RESPONSE'));
});

test('readLimited joins bytes before UTF-8 decoding and accepts the exact byte limit', async () => {
  const text = '{"message":"你好 🌅"}';
  const response = chunkedResponse(text, 1);
  assert.equal(await readLimited(response, Buffer.byteLength(text)), text);
  assert.equal(response.body.locked, false);
});

test('readLimited cancels oversized declared bodies without obtaining a reader', async () => {
  let cancelled = 0;
  const response = {
    headers: new Headers({ 'Content-Length': '101' }),
    body: { cancel: async () => { cancelled++; }, getReader() { assert.fail('Must reject before reading.'); } },
  };
  await assert.rejects(readLimited(response, 100), hasCode('RESPONSE_TOO_LARGE'));
  assert.equal(cancelled, 1);
});

test('readLimited enforces actual streamed bytes even if Content-Length understates them', async () => {
  let cancelled = 0;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const response = new Response(body, { headers: { 'Content-Length': '1' } });
  await assert.rejects(readLimited(response, 5), hasCode('RESPONSE_TOO_LARGE'));
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('empty bodies and reader failures release resources', async () => {
  await assert.rejects(readLimited(new Response(null), 100), hasCode('EMPTY_RESPONSE'));
  const failure = new Error('stream failed');
  const body = new ReadableStream({ start(controller) { controller.error(failure); } });
  await assert.rejects(readLimited(new Response(body), 100), error => error === failure);
  assert.equal(body.locked, false);
});

test('successful responses respect the configured decompressed limit and errors have a separate 64 KiB limit', async () => {
  let calls = 0;
  await assert.rejects(invoke({
    config: { ...CONFIG, maxResponseMiB: 1 },
    fetchImpl: async () => { calls++; return chunkedResponse(' '.repeat(1024 * 1024 + 1)); },
  }), hasCode('RESPONSE_TOO_LARGE'));
  assert.equal(calls, 1);
  await assert.rejects(invoke({ fetchImpl: async () => new Response('x'.repeat(64 * 1024 + 1), { status: 500 }) }), hasCode('RESPONSE_TOO_LARGE'));
});

test('timeout aborts the in-flight request, warns about accepted work and does not retry', async () => {
  let calls = 0;
  let requestSignal;
  await assert.rejects(invoke({
    config: { ...CONFIG, timeoutMs: 15 },
    fetchImpl: async (_url, { signal }) => { calls++; requestSignal = signal; return waitForAbort(signal); },
  }), error => {
    hasCode('TIMEOUT')(error);
    assert.match(error.message, /accepted work may be charged/);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(requestSignal.aborted, true);
});

test('caller cancellation aborts an in-flight request without exposing its reason or retrying', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(invoke({ signal: controller.signal, fetchImpl: async (_url, { signal }) => {
    calls++;
    queueMicrotask(() => controller.abort(new Error(API_KEY)));
    return waitForAbort(signal);
  } }), error => {
    hasCode('CANCELLED')(error);
    assert.match(error.message, /provider may still charge/);
    return true;
  });
  assert.equal(calls, 1);
});

test('already-cancelled requests return the same safe CANCELLED error before calling fetch', async () => {
  let calls = 0;
  await assert.rejects(invoke({
    signal: AbortSignal.abort(new Error(API_KEY)),
    fetchImpl: async () => { calls++; return jsonResponse(payload()); },
  }), hasCode('CANCELLED'));
  assert.equal(calls, 0);
});

test('cancellation after fetch returns is checked before returning decoded images', async () => {
  const controller = new AbortController();
  await assert.rejects(invoke({ signal: controller.signal, fetchImpl: async () => {
    controller.abort(new Error(API_KEY));
    return jsonResponse(payload());
  } }), hasCode('CANCELLED'));
});

test('timeout and caller cancellation also interrupt response-body reads and release the reader', async t => {
  for (const source of ['timeout', 'caller']) {
    await t.test(source, async () => {
      const controller = new AbortController();
      let body;
      let reads = 0;
      let calls = 0;
      await assert.rejects(invoke({
        config: { ...CONFIG, timeoutMs: source === 'timeout' ? 15 : 2_000 },
        signal: controller.signal,
        fetchImpl: async (_url, { signal }) => {
          calls++;
          body = new ReadableStream({
            start(stream) {
              stream.enqueue(Buffer.from('{"data":'));
              const guard = setTimeout(() => stream.error(new Error('Body read was not aborted.')), 1_000);
              signal.addEventListener('abort', () => {
                clearTimeout(guard);
                stream.error(signal.reason);
              }, { once: true });
            },
            pull() {
              reads++;
              if (source === 'caller') queueMicrotask(() => controller.abort(new Error(API_KEY)));
            },
          }, { highWaterMark: 0 });
          return new Response(body);
        },
      }), hasCode(source === 'timeout' ? 'TIMEOUT' : 'CANCELLED'));
      assert.equal(calls, 1);
      assert.ok(reads >= 1);
      assert.equal(body.locked, false);
    });
  }
});
