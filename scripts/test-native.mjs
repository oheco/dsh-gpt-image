import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Point at the Node entrypoint of the installed DSH, not its shell launcher.
const entry = process.env.DSH_RUNTIME_ENTRY;
if (!entry || !path.isAbsolute(entry)) throw new Error('Set DSH_RUNTIME_ENTRY to the absolute DSH JavaScript entrypoint.');
if (!process.env.TMPDIR) throw new Error('TMPDIR is required for isolated attachment storage.');
const require = createRequire(entry);
const { Context } = require('@deepseek-ai/cordis');
const { ToolRuntime } = require('@deepseek-ai/dsh-tools');
const { LocalAttachmentStore } = require('@deepseek-ai/dsh-attachment-local');
const { SystemPrompt } = require('@deepseek-ai/dsh-system-prompt');
const { apply: selectNativeExecutor } = require('@deepseek-ai/dsh-tool-executor-native');
const { default: Loader } = require('@deepseek-ai/cordis-plugin-loader');
const { default: ConfigEditor } = require('@deepseek-ai/dsh-config-editor');
const { SettingsForms } = require('@deepseek-ai/dsh-settings');
const { LocalCredentialProvider } = require('@deepseek-ai/dsh-credentials-local');
const { mountRootInclude, readProfilePatches } = require('@deepseek-ai/dsh-app-boot');
const { ClientModuleRegistry } = require('@deepseek-ai/dsh-client-modules');
const schema = require('@deepseek-ai/schemastery');
const Schema = schema.default ?? schema;
const previousEntry = process.argv[1];
process.argv[1] = entry;
await import('../index.js');
process.argv[1] = previousEntry;
const temp = await mkdtemp(path.join(process.env.TMPDIR, 'dsh-gpt-image-native-'));
const originalFetch = globalThis.fetch;
const ctx = new Context();
const ns = 'oheco-gpt-image';
const oldRef = 'FIXTURE_IMAGE_API_KEY', newRef = 'FIXTURE_IMAGE_NEXT_KEY';
const oldKey = 'fixture-key', newKey = 'fixture-next-key', rotatedKey = 'fixture-rotated-key';
try {
  const profile = {
    name: 'image-fixture', dir: path.join(temp, 'profile'), home: path.join(temp, 'home'), cwd: temp,
    patchPath: path.join(temp, 'profile', 'cordis.patch.yml'),
    installAnchor: path.resolve(path.dirname(entry), '../package.json'),
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  };
  await mkdir(profile.dir);
  await mkdir(profile.home);
  await writeFile(path.join(profile.dir, 'package.json'), JSON.stringify({ name: 'image-fixture', private: true, dsh: { profile: { bundles: [] } } }));
  const baseFile = path.join(temp, 'base.yml');
  await writeFile(baseFile, '[]\n');
  const inherited = { provider: '', baseURL: 'https://fixture.example/v1', apiKeyEnv: oldRef, maxImages: 3 };
  const directory = [{ provider: 'fixture-chat', settingsNs: 'fixture-connections', settingsPath: ['connection'] }];
  const connection = { api: 'openai-responses', baseURL: 'https://reused.example/v1', apiKeyEnv: oldRef };
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [
    { id: 'fixture-connections', name: 'cordis:fixture-connections', config: { connection } },
    { id: ns, name: new URL('../upload-host.js', import.meta.url).href, config: inherited },
  ] }]));
  ctx.provide('profileContext', profile);
  ctx.provide('llm', { listConfigurableProviders: () => directory });
  new SystemPrompt(ctx, {});
  const tools = new ToolRuntime(ctx);
  selectNativeExecutor(ctx);
  const attachments = new LocalAttachmentStore(ctx, { dshHome: temp });
  const credentials = new LocalCredentialProvider(ctx, { dshHome: profile.home, watch: false });
  await credentials.set(oldRef, oldKey);
  await credentials.set(newRef, newKey);
  await ctx.plugin({ name: 'fixture-config-services', apply(c) {
    new Loader(c, { baseUrl: pathToFileURL(temp + '/').href });
    new ConfigEditor(c);
    new SettingsForms(c);
  } });
  Object.assign(ctx.loader.builtins, {
    'fixture-connections': {
      Config: Schema.object({ connection: Schema.object({ api: Schema.string(), baseURL: Schema.string(), apiKeyEnv: Schema.string() }).volatile() }),
      apply() {},
    },
  });
  await mountRootInclude(ctx, baseFile, readProfilePatches('dsh', profile));
  await ctx.loader.await();
  const registry = new ClientModuleRegistry(ctx);
  const packageId = '@oheco/dsh-gpt-image';
  const client = registry.graph().entries.find(item => item.id === packageId);
  assert.equal(client?.immediately, true);
  assert.ok(client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
  const bundle = await registry.fetchBundle(new Request(new URL(client.url, 'http://127.0.0.1/')));
  assert.equal(bundle.status, 200);
  assert.ok((await bundle.text()).includes('plugins.bundle.config'));
  const form = () => ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns);
  const initial = form();
  assert.deepEqual(initial.value, {
    provider: '', baseURL: inherited.baseURL, apiKeyEnv: oldRef,
    defaultModel: 'gpt-image-2.5-flare', defaultEditModel: 'gpt-image-2.5-sunburst',
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${[oldKey, newKey, newKey, rotatedKey, rotatedKey, oldKey][requests]}`);
    if ([0, 4, 5].includes(requests)) {
      const base = requests === 0 ? inherited.baseURL : requests === 4 ? 'https://next.example/v1' : connection.baseURL;
      assert.equal(url, `${base}/images/generations`);
      assert.equal(JSON.parse(options.body).model, requests === 0 ? 'gpt-image-2.5-flare' : 'gpt-image-2.6-flare');
    } else {
      assert.equal(url, 'https://next.example/v1/images/edits');
      assert.equal(headers.has('Content-Type'), false);
      assert.equal(options.body.get('model'), requests === 2 ? 'gpt-image-2.5-flare' : 'gpt-image-2.6-sunburst');
      assert.deepEqual(Buffer.from(await options.body.get('image').arrayBuffer()), png);
      if (requests === 3) assert.deepEqual(Buffer.from(await options.body.get('mask').arrayBuffer()), png);
    }
    requests++;
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  const execute = async (name, args, id) => {
    const batch = await tools.execute({ calls: [{ type: 'tool-call', name, arguments: JSON.stringify(args), id }], signal: new AbortController().signal });
    return batch.results[0].result;
  };
  const result = await execute('generate_image', { prompt: 'native fixture validation' }, 'native-image-call');
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(requests, 1);
  assert.deepEqual(result.content.map(part => part.type), ['text', 'image', 'file']);
  const image = result.value.images[0];
  assert.deepEqual(await readFile(image.path), png);
  const preview = await attachments.readImage(image.preview);
  assert.equal(preview.ref.width, 1);
  assert.equal(preview.ref.height, 1);
  assert.deepEqual(Buffer.from(preview.data), png);
  const changes = {
    baseURL: 'https://next.example/v1', apiKeyEnv: newRef,
    defaultModel: 'gpt-image-2.6-flare', defaultEditModel: 'gpt-image-2.6-sunburst',
  };
  const set = values => Object.entries(values).map(([key, value]) => ({ op: 'set', path: [key], value }));
  const running = ctx.loader.resolve(`include:${ns}`).fiber;
  await ctx.settings.mutate(ns, set(changes), initial.revision);
  assert.equal(ctx.loader.resolve(`include:${ns}`).fiber, running, 'live settings do not restart the image plugin');
  assert.deepEqual(form().value, { provider: '', ...changes });
  const savedPatch = await readFile(profile.patchPath, 'utf8');
  for (const value of Object.values(changes)) assert.ok(savedPatch.includes(value));
  assert.ok(/maxImages:\s*3/.test(savedPatch));
  for (const key of [oldKey, newKey, rotatedKey]) assert.ok(!savedPatch.includes(key));
  await assert.rejects(ctx.settings.mutate(ns, set({ defaultModel: 'gpt-image-2.6' }), form().revision));
  await assert.rejects(ctx.settings.mutate(ns, set({ defaultModel: 'gpt-image-2.5-flare' }), initial.revision));
  assert.equal(await readFile(profile.patchPath, 'utf8'), savedPatch);
  const edited = await execute('edit_image', { prompt: 'Make the source red', images: [image.original] }, 'native-image-edit');
  assert.equal(edited.isError, false, JSON.stringify(edited));
  assert.equal(edited.value.model, 'gpt-image-2.6-sunburst');
  assert.deepEqual(edited.content.map(part => part.type), ['text', 'image', 'file']);
  const continued = await execute('edit_image', { prompt: 'Make the source blue', images: [edited.value.images[0].original], model: 'gpt-image-2.5-flare' }, 'native-image-followup');
  assert.equal(continued.isError, false, JSON.stringify(continued));
  assert.equal(continued.value.model, 'gpt-image-2.5-flare');
  assert.equal(requests, 3);
  assert.deepEqual(await readFile(continued.value.images[0].path), png);
  await credentials.set(newRef, rotatedKey);
  const masked = await execute('edit_image', { prompt: 'Edit the masked region', images: [image.original], mask: image.original }, 'native-image-mask');
  assert.equal(masked.isError, false, JSON.stringify(masked));
  assert.equal(requests, 4);
  assert.deepEqual(await readFile(masked.value.images[0].path), png);
  const latest = await execute('generate_image', { prompt: 'Use new model default' }, 'native-image-next');
  assert.equal(latest.isError, false, JSON.stringify(latest));
  assert.equal(latest.value.model, 'gpt-image-2.6-flare');
  assert.equal(requests, 5);
  assert.equal(await readFile(profile.patchPath, 'utf8'), savedPatch, 'key rotation never edits profile config');
  await ctx.settings.mutate(ns, set({ provider: directory[0].provider }), form().revision);
  const reused = await execute('generate_image', { prompt: 'Use the DSH connection' }, 'native-image-reused');
  assert.equal(reused.isError, false, JSON.stringify(reused));
  assert.equal(reused.value.model, 'gpt-image-2.6-flare');
  assert.equal(ctx.loader.resolve(`include:${ns}`).fiber, running);
  assert.equal(requests, 6);
  console.log(JSON.stringify({ verified: true, requests, liveSettings: true, credentialsRotated: true, reusedConnection: true, maskedMultipart: true, fixture: true }));
} finally {
  globalThis.fetch = originalFetch;
  await ctx.fiber.dispose();
  const resolved = await realpath(temp), parent = await realpath(process.env.TMPDIR);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('dsh-gpt-image-native-')) throw new Error('Unexpected cleanup target');
  await rm(resolved, { recursive: true, force: true });
}
