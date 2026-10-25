import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostModule } from '../runtime.js';

async function withHost(fn) {
  assert.ok(process.env.TMPDIR, 'TMPDIR is required for private test storage');
  const temp = await mkdtemp(path.join(process.env.TMPDIR, 'gpt-image-runtime-'));
  const previousEntry = process.argv[1];
  try {
    const host = path.join(temp, 'fake host');
    await mkdir(host);
    process.argv[1] = path.join(host, 'entry.mjs');
    await writeFile(process.argv[1], '// fixture Host entrypoint\n');
    await fn(host);
  } finally {
    process.argv[1] = previousEntry;
    const target = await realpath(temp), parent = await realpath(process.env.TMPDIR);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith('gpt-image-runtime-'));
    await rm(target, { recursive: true, force: true });
  }
}

async function fixture(host, name, type, source) {
  const dir = path.join(host, 'node_modules', '@gpt-image-test', name);
  await mkdir(dir, { recursive: true });
  const filename = type === 'module' ? 'index.mjs' : 'index.cjs';
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@gpt-image-test/' + name, type, main: filename }));
  await writeFile(path.join(dir, filename), source);
  return path.join(dir, filename);
}

test('joins an in-flight Host ESM import rather than requiring a partially loaded module', async () => {
  await withHost(async host => {
    const filename = await fixture(host, 'concurrent', 'module', 'await new Promise(resolve => setTimeout(resolve, 20)); export const ready = true;');
    const hostLoad = import(pathToFileURL(filename).href);
    const pluginLoad = hostModule('@gpt-image-test/concurrent');
    const [fromHost, fromPlugin] = await Promise.all([hostLoad, pluginLoad]);
    assert.strictEqual(fromPlugin, fromHost);
    assert.equal(fromPlugin.ready, true);
  });
});

test('preserves a CommonJS default export when resolving from the Host', async () => {
  await withHost(async host => {
    await fixture(host, 'commonjs', 'commonjs', 'module.exports = { value: 42 };');
    const module = await hostModule('@gpt-image-test/commonjs');
    assert.equal(module.default.value, 42);
  });
});
