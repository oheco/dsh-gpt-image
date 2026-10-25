import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// Directory-installed bundles resolve from their checkout. Resolve missing
// dependencies against the running Host, then await native ESM loading: the
// Host may already be importing the same package during concurrent startup.
export async function hostModule(name) {
  const local = createRequire(import.meta.url);
  let resolved;
  try { resolved = local.resolve(name); }
  catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
    const entrypoint = process.argv[1];
    if (!entrypoint || !isAbsolute(entrypoint)) throw error;
    resolved = createRequire(realpathSync(entrypoint)).resolve(name);
  }
  return import(pathToFileURL(resolved).href);
}
