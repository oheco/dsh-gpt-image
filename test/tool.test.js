import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerateTool } from '../tool.js';

// Complete, valid 1×1 RGBA PNG; no provider or image-library dependency is needed.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const MODEL = 'gpt-image-2.5-sunburst';
const API_KEY = 'sk-tool-unit-test-secret';
const CONFIG = { baseURL: 'https://unused-config.example/v1', defaultModel: MODEL, maxImages: 4, timeoutMs: 2_000 };
const CONNECTION = { baseURL: 'https://connection.example.test/v1', apiKey: API_KEY };
const ARGS = { prompt: 'A red pixel.' };
const exec = signal => ({ signal: signal ?? new AbortController().signal });
const response = (n, overrides = {}) => new Response(JSON.stringify({
  data: Array.from({ length: n }, () => ({ b64_json: PNG_BASE64 })), ...overrides,
}));

function harness(options = {}) {
  const events = [];
  const validated = [];
  const originals = [];
  const previews = [];
  const attachments = {
    async validateImage(input) {
      events.push(`validate:${validated.length + 1}`);
      validated.push(input);
    },
    async saveFile(input) {
      events.push(`file:${originals.length + 1}`);
      const attachment = Object.freeze({ id: `original-${originals.length + 1}`, name: input.name });
      originals.push({ input, attachment });
      return attachment;
    },
    async saveImage(input) {
      events.push(`preview:${previews.length + 1}`);
      const attachment = Object.freeze({ id: `preview-${previews.length + 1}`, name: input.name });
      previews.push({ input, attachment });
      return attachment;
    },
    fileHostPath(original) {
      events.push(`path:${original.id}`);
      return options.omitPaths ? undefined : `/attachments/${original.name}`;
    },
  };
  const requests = [];
  const tool = createGenerateTool({
    config: { ...CONFIG, ...options.config }, attachments, signal: options.pluginSignal,
    resolveConnection: options.resolveConnection ?? (async () => { events.push('resolve'); return CONNECTION; }),
    fetchImpl: async (url, init) => {
      events.push('fetch');
      requests.push({ url, init });
      return options.fetchImpl ? options.fetchImpl(url, init) : response(JSON.parse(init.body).n, {
        usage: { input_tokens: 3, output_tokens: 7 },
      });
    },
  });
  return { tool, attachments, events, validated, originals, previews, requests };
}

test('generating a batch validates every image before saving originals and previews', async () => {
  const h = harness();
  const result = await h.tool.execute({ ...ARGS, n: 2 }, exec());
  assert.deepEqual(h.events, [
    'resolve', 'fetch', 'validate:1', 'validate:2',
    'file:1', 'preview:1', 'path:original-1', 'file:2', 'preview:2', 'path:original-2',
  ]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `${CONNECTION.baseURL}/images/generations`);
  assert.equal(h.requests[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(result.model, MODEL);
  assert.deepEqual(result.usage, { input_tokens: 3, output_tokens: 7 });
  assert.equal(result.images.length, 2);
  let batch;
  for (let i = 0; i < 2; i++) {
    const input = h.validated[i];
    assert.deepEqual(input.data, PNG);
    assert.equal(input.mediaType, 'image/png');
    const match = input.name.match(/^gpt-image-2\.5-sunburst-([a-f0-9-]{36})-([12])\.png$/);
    assert.ok(match, input.name);
    assert.equal(match[2], String(i + 1));
    if (i === 0) batch = match[1];
    else assert.equal(match[1], batch);
    assert.deepEqual(h.originals[i].input, { data: input.data, name: input.name });
    assert.strictEqual(h.originals[i].input.data, input.data);
    assert.strictEqual(h.previews[i].input, input);
    assert.deepEqual(result.images[i], {
      preview: h.previews[i].attachment, original: h.originals[i].attachment,
      path: `/attachments/${input.name}`,
    });
  }
  assert.equal(h.tool.timeoutMs, CONFIG.timeoutMs + 30_000);
  assert.equal(h.tool.isConcurrencySafe(), true);
});

test('render returns JSON text followed by an image preview and original file for each image', async () => {
  const h = harness();
  const result = await h.tool.execute({ ...ARGS, n: 2 }, exec());
  const rendered = h.tool.output.render(ARGS, result);
  assert.equal(rendered.length, 5);
  assert.equal(rendered[0].type, 'text');
  assert.deepEqual(JSON.parse(rendered[0].text), result);
  assert.deepEqual(rendered.slice(1), result.images.flatMap(image => [
    { type: 'image', attachment: image.preview }, { type: 'file', attachment: image.original },
  ]));
  assert.strictEqual(rendered[1].attachment, h.previews[0].attachment);
  assert.strictEqual(rendered[2].attachment, h.originals[0].attachment);
  assert.ok(!JSON.stringify(rendered).includes(API_KEY));
});

test('missing host paths and provider usage are omitted from the output', async () => {
  const h = harness({ omitPaths: true, fetchImpl: async () => response(1) });
  const result = await h.tool.execute(ARGS, exec());
  assert.deepEqual(Object.keys(result).sort(), ['images', 'model']);
  assert.deepEqual(Object.keys(result.images[0]).sort(), ['original', 'preview']);
  const second = await h.tool.execute(ARGS, exec());
  assert.notEqual(h.originals[0].input.name, h.originals[1].input.name);
  assert.equal(second.images.length, 1);
});

test('failure validating the second image saves none of the batch', async () => {
  const h = harness();
  const failure = new Error('The attachment decoder rejected image two.');
  const validate = h.attachments.validateImage;
  h.attachments.validateImage = async input => {
    await validate(input);
    if (h.validated.length === 2) throw failure;
  };
  await assert.rejects(h.tool.execute({ ...ARGS, n: 2 }, exec()), error => error === failure);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1', 'validate:2']);
  assert.deepEqual(h.originals, []);
  assert.deepEqual(h.previews, []);
  assert.equal(h.requests.length, 1);
});

test('one malformed API image rejects the whole result before attachment validation', async () => {
  const h = harness({ fetchImpl: async () => new Response(JSON.stringify({ data: [
    { b64_json: PNG_BASE64 }, { b64_json: 'not-base64' },
  ] })) });
  await assert.rejects(h.tool.execute({ ...ARGS, n: 2 }, exec()), { code: 'INVALID_IMAGE' });
  assert.deepEqual(h.events, ['resolve', 'fetch']);
});

test('connection lookup failure performs no request or attachment work', async () => {
  const failure = new Error('Credential unavailable.');
  const h = harness({ resolveConnection: async () => { throw failure; } });
  await assert.rejects(h.tool.execute(ARGS, exec()), error => error === failure);
  assert.deepEqual(h.events, []);
});

test('provider failure saves nothing and is not retried by the tool', async () => {
  const h = harness({ fetchImpl: async () => new Response(JSON.stringify({
    error: { message: `This group cannot generate images: ${API_KEY}` },
  }), { status: 403 }) });
  await assert.rejects(h.tool.execute(ARGS, exec()), error => {
    assert.equal(error.code, 'API_ERROR');
    assert.match(error.message, /This group cannot generate images/);
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
  assert.deepEqual(h.events, ['resolve', 'fetch']);
  assert.equal(h.requests.length, 1);
});

test('a failed original save never attempts its preview or retries generation', async () => {
  const h = harness();
  const failure = new Error('File store unavailable.');
  h.attachments.saveFile = async () => { h.events.push('file:failed'); throw failure; };
  await assert.rejects(h.tool.execute(ARGS, exec()), error => error === failure);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1', 'file:failed']);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.previews, []);
});

test('a failed preview save propagates the failure without retrying or starting the next image', async () => {
  const h = harness();
  const failure = new Error('Preview store unavailable.');
  h.attachments.saveImage = async () => { h.events.push('preview:failed'); throw failure; };
  await assert.rejects(h.tool.execute({ ...ARGS, n: 2 }, exec()), error => error === failure);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1', 'validate:2', 'file:1', 'preview:failed']);
  assert.equal(h.originals.length, 1);
  assert.equal(h.requests.length, 1);
});

test('already-cancelled execution and disposed plugin stop before resolving credentials', async t => {
  for (const source of ['execution', 'plugin']) {
    await t.test(source, async () => {
      const reason = new Error(`Cancelled ${source}`);
      const signal = AbortSignal.abort(reason);
      const h = harness({ pluginSignal: source === 'plugin' ? signal : undefined });
      await assert.rejects(h.tool.execute(ARGS, exec(source === 'execution' ? signal : undefined)), error => error === reason);
      assert.deepEqual(h.events, []);
    });
  }
});

test('execution cancellation and plugin disposal abort an active request without saving or retrying', async t => {
  for (const source of ['execution', 'plugin']) {
    await t.test(source, async () => {
      const controller = new AbortController();
      let requestSignal;
      const h = harness({
        pluginSignal: source === 'plugin' ? controller.signal : undefined,
        fetchImpl: async (_url, { signal }) => {
          requestSignal = signal;
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            queueMicrotask(() => controller.abort(new Error(API_KEY)));
          });
        },
      });
      await assert.rejects(h.tool.execute(ARGS, exec(source === 'execution' ? controller.signal : undefined)), error => {
        assert.equal(error.code, 'CANCELLED');
        assert.ok(!error.message.includes(API_KEY));
        return true;
      });
      assert.equal(requestSignal.aborted, true);
      assert.deepEqual(h.events, ['resolve', 'fetch']);
      assert.equal(h.requests.length, 1);
    });
  }
});

test('cancellation while validating prevents all writes and the next validation', async () => {
  const controller = new AbortController();
  const reason = new Error('Stop while validating.');
  const h = harness();
  const validate = h.attachments.validateImage;
  h.attachments.validateImage = async input => { await validate(input); controller.abort(reason); };
  await assert.rejects(h.tool.execute({ ...ARGS, n: 2 }, exec(controller.signal)), error => error === reason);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1']);
  assert.deepEqual(h.originals, []);
  assert.deepEqual(h.previews, []);
});

test('plugin disposal while saving an original stops before saving its preview', async () => {
  const controller = new AbortController();
  const reason = new Error('Plugin unloaded while saving.');
  const h = harness({ pluginSignal: controller.signal });
  const saveFile = h.attachments.saveFile;
  h.attachments.saveFile = async input => {
    const original = await saveFile(input);
    controller.abort(reason);
    return original;
  };
  await assert.rejects(h.tool.execute(ARGS, exec()), error => error === reason);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1', 'file:1']);
  assert.equal(h.originals.length, 1);
  assert.deepEqual(h.previews, []);
});

test('plugin disposal while saving a preview rejects instead of returning a completed result', async () => {
  const controller = new AbortController();
  const reason = new Error('Plugin unloaded during preview persistence.');
  const h = harness({ pluginSignal: controller.signal });
  const saveImage = h.attachments.saveImage;
  h.attachments.saveImage = async input => {
    const preview = await saveImage(input);
    controller.abort(reason);
    return preview;
  };
  await assert.rejects(h.tool.execute(ARGS, exec()), error => error === reason);
  assert.deepEqual(h.events, ['resolve', 'fetch', 'validate:1', 'file:1', 'preview:1']);
  assert.equal(h.originals.length, 1);
  assert.equal(h.previews.length, 1);
});
