/**
 * Vendor @webjsdev/intellisense into webjs.nvim so the plugin is self-contained
 * (#398). A Neovim plugin has no install-time build step (lazy.nvim just
 * clones the repo), so the language-service plugin must be COMMITTED inside
 * the plugin and pointed at via tsserver's probe location.
 *
 * Re-run this after any change under `packages/editors/intellisense/src`, AND
 * after any edit to that package's `package.json` other than its `version`.
 * The drift guard in `../test/vendor-sync.test.mjs` compares both, sparing the
 * version because no release step re-vendors.
 *
 * @webjsdev/intellisense is standalone, dependency-free plain CJS (#386), so we
 * copy its `package.json` + `src/` verbatim into
 *   packages/editors/nvim/vendor/node_modules/@webjsdev/intellisense/
 * tsserver resolves a plugin as `<probeLocation>/node_modules/<name>`, so the
 * probe location handed to ts_ls is `<plugin-root>/vendor` (see
 * lua/webjs/init.lua `bundled_location`).
 *
 * NOTE on committing: the output lives under a `node_modules/` dir, which the
 * repo's root .gitignore excludes. The files are committed anyway via
 * `git add -f` (once tracked, git keeps staging their changes regardless of
 * .gitignore). The standalone webjs.nvim repo (a subtree split of
 * packages/editors/nvim) ships them as ordinary files. Re-run this whenever
 * `packages/editors/intellisense/src` changes, then `git add -f packages/editors/nvim/vendor`.
 * `test/vendor-sync.test.mjs` fails if the committed copy drifts from source.
 */
import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NVIM = resolve(HERE, '..');
const SRC = resolve(NVIM, '../intellisense');
const DEST = resolve(NVIM, 'vendor/node_modules/@webjsdev/intellisense');

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(resolve(SRC, 'src'), resolve(DEST, 'src'), { recursive: true });
copyFileSync(resolve(SRC, 'package.json'), resolve(DEST, 'package.json'));

console.log(`[vendor] copied @webjsdev/intellisense src + package.json -> ${DEST}`);
console.log('[vendor] remember: git add -f packages/editors/nvim/vendor  (node_modules is gitignored)');
