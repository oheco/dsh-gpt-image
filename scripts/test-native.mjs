import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

// Point at the Node entrypoint of the installed DSH, not its shell launcher.
const entry = process.env.DSH_RUNTIME_ENTRY;
if (!entry || !path.isAbsolute(entry)) throw new Error('Set DSH_RUNTIME_ENTRY to the absolute DSH JavaScript entrypoint.');
if (!process.env.TMPDIR) throw new Error('TMPDIR is required for isolated attachment storage.');
const require = createRequire(entry);
const { Context, Service } = require('@deepseek-ai/cordis');
const { ToolRuntime } = require('@deepseek-ai/dsh-tools');
const { LocalAttachmentStore } = require('@deepseek-ai/dsh-attachment-local');
const { SystemPrompt } = require('@deepseek-ai/dsh-system-prompt');
const previousEntry = process.argv[1];
process.argv[1] = entry;
const plugin = await import('../index.js');
process.argv[1] = previousEntry;
const temp = await mkdtemp(path.join(process.env.TMPDIR, 'dsh-gpt-image-native-'));
const originalFetch = globalThis.fetch;
try {
  const ctx = new Context();
  new SystemPrompt(ctx, {});
  const tools = new ToolRuntime(ctx);
  const attachments = new LocalAttachmentStore(ctx, { dshHome: temp });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
  const credentials = new Service(ctx, 'credentials');
  credentials.resolve = async ref => { assert.equal(ref, 'FIXTURE_IMAGE_API_KEY'); return { value: 'fixture-key', source: 'test' }; };
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://fixture.example/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    assert.equal(JSON.parse(options.body).model, 'gpt-image-2.5-flare');
    requests++;
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  plugin.apply(ctx, plugin.Config({ provider: '', baseURL: 'https://fixture.example/v1', apiKeyEnv: 'FIXTURE_IMAGE_API_KEY' }));
  const result = await tools.execute({ name: 'generate_image', arguments: { prompt: 'native fixture validation' }, callId: 'native-image-call', signal: new AbortController().signal });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(requests, 1);
  assert.deepEqual(result.content.map(part => part.type), ['text', 'image', 'file']);
  const image = result.value.images[0];
  assert.deepEqual(await readFile(image.path), png);
  const preview = await attachments.readImage(image.preview);
  assert.equal(preview.ref.width, 1);
  assert.equal(preview.ref.height, 1);
  assert.deepEqual(Buffer.from(preview.data), png);
  console.log(JSON.stringify({ verified: true, requests, content: result.content.map(part => part.type), originalBytes: png.length, preview: '1x1', fixture: true }));
} finally {
  globalThis.fetch = originalFetch;
  const resolved = await realpath(temp), parent = await realpath(process.env.TMPDIR);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('dsh-gpt-image-native-')) throw new Error('Unexpected cleanup target');
  await rm(resolved, { recursive: true, force: true });
}
