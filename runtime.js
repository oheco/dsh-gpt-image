import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

// A directory-installed bundle is a symlink to the checkout. Node resolves its
// imports there, so use the running Host's entrypoint as the fallback anchor.
// This also keeps the plugin on the Host's exact library versions.
export function hostModule(name) {
  const local = createRequire(import.meta.url);
  try { return local(name); }
  catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
    const entrypoint = process.argv[1];
    if (!entrypoint || !isAbsolute(entrypoint)) throw error;
    return createRequire(realpathSync(entrypoint))(name);
  }
}
