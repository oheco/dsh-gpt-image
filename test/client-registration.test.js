import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { MODELS } from '../image-api.js';

const file = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('the bundled Client registers both settings pages on the same Host form', async () => {
  const manifest = JSON.parse(await file('package.json'));
  const client = manifest.exports['./client'];
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.ok(manifest.files.includes(client.slice(2)));
  const source = await file(client);
  let module;
  runInNewContext(source, { window: { __ModuleLoader__: { load(spec) { module = spec; } } } });
  assert.equal(module.id, manifest.name);
  const clientPlugin = module.factory(name => { assert.equal(name, 'react'); return {}; });
  const form = {}, mirror = {}, slots = [];
  let labels;
  clientPlugin.apply({
    effect(register) { register(); },
    locale: { register(_namespace, dictionaries) { labels = dictionaries; } },
    configForms: { get(id) { assert.equal(id, 'oheco-gpt-image'); return form; }, describe() { return mirror; } },
    slots: {
      inject(name, register) { assert.ok(name.startsWith('plugins.')); register(); },
      register(entry, component) { assert.equal(typeof component, 'function'); slots.push(entry); },
    },
  });
  assert.deepEqual(slots.map(({ name, key }) => [name, key]), [
    ['plugins.bundle.config', manifest.name], ['plugins.row.config', `${manifest.name}#oheco-gpt-image`],
  ]);
  for (const slot of slots) {
    const props = slot.inject();
    assert.equal(props.settingsForm, form);
    assert.equal(props.describe, mirror);
  }
  assert.deepEqual(Object.keys(labels.en).sort(), Object.keys(labels.zh).sort());
  const declared = source.match(/const MODELS = \[([^\]]+)\]/)?.[1];
  const clientModels = Array.from(declared.matchAll(/'([^']+)'/g), match => match[1]);
  assert.deepEqual(clientModels.sort(), [...MODELS].sort());
});
