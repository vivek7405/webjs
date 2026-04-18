/**
 * ESM loader hook that redirects `import('ioredis')` to our in-memory
 * fake. Used by the cache / session Redis unit tests so they can run
 * without a live Redis server.
 *
 * Register via `module.register(new URL('./ioredis-loader.mjs', import.meta.url))`
 * before any module that would dynamically import 'ioredis'.
 */
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fake = resolvePath(here, 'fake-ioredis.mjs');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'ioredis') {
    return nextResolve(new URL(`file://${fake}`).href, context);
  }
  // Also block the secondary 'redis' package so the code doesn't try
  // to fall through and fail for unrelated reasons in our mock tests.
  if (specifier === 'redis') {
    const err = new Error('blocked by test loader');
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return nextResolve(specifier, context);
}
