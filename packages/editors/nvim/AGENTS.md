# AGENTS.md for webjs.nvim

The Neovim editor plugin for webjs, the counterpart to the `webjs` VS Code
extension (`packages/editors/vscode`). Phase 4 of the editor-plugin epic (#381).

Framework-wide rules (workflow, no-build, commit conventions) live in the
framework root [`../../AGENTS.md`](../../AGENTS.md). This file covers what is
specific to the Neovim plugin.

## What it ships

1. **Highlighting** (`queries/{typescript,javascript}/injections.scm`):
   treesitter injection queries that inject `html` / `css` / `svg` into the
   matching tagged templates. They begin with `; extends` so they ADD to
   nvim-treesitter's built-in injections rather than replacing them. A webjs
   template parses as `(call_expression (identifier) (template_string))`; the
   captured tag name IS the injected language (`@injection.language`). Neovim
   auto-loads any `queries/<lang>/<kind>.scm` on the runtimepath, so no Lua
   wires this up.
2. **Lua** (`lua/webjs/`): `init.lua` (`setup()`, the `:WebjsCheck` command,
   the `with_tsserver_plugin()` LSP helper for ts_ls AND `with_vtsls_plugin()`
   for vtsls/LazyVim, #405), `check.lua` (`webjs check --json`
   to `vim.diagnostic` + quickfix), `health.lua` (`:checkhealth webjs`).
   `plugin/webjs.lua` registers `:WebjsCheck` so it works without an explicit
   `setup()`.
3. **Bundled language service** (`vendor/node_modules/@webjsdev/intellisense/`):
   a committed verbatim copy of the standalone `@webjsdev/intellisense` (#386).
   `with_tsserver_plugin()` points `tsserver` at it via `plugins[].location`
   (-> `pluginProbeLocations`), so intelligence works with NO
   `@webjsdev/intellisense` in the app (before `npm install`, pruned trees,
   non-scaffolded apps). When the app ALSO wires it via `tsconfig`, `tsserver`
   dedupes by name (verified), so no double-load. **This copy is GENERATED,
   never hand-edit a file under `vendor/node_modules/@webjsdev/intellisense/`.**
   To change its behaviour, edit `packages/editors/intellisense/src/` (the source
   of truth) and regenerate: `node packages/editors/nvim/scripts/vendor-intellisense.mjs`
   then `git add -f packages/editors/nvim/vendor` (the output is under a gitignored
   `node_modules/`). The `test/vendor-sync.test.mjs` drift guard FAILS the
   "Unit + integration" CI job ("vendored intellisense src is byte-identical ...")
   whenever the copy and `src/` diverge, whether you forgot to re-vendor after an
   intellisense edit OR hand-edited the copy. It also compares the vendored
   `package.json` against the source manifest in every field, `version`
   included, so a description, an exports, or a release-time version edit there
   all need a re-vendor. Confirm green with
   `node --test packages/editors/nvim/test/vendor-sync.test.mjs`.
4. **Docs**: `doc/webjs.txt` (`:help webjs`), `README.md`.

## Invariants

1. **No Lit dependency.** Highlighting is our own treesitter queries;
   intelligence is the standalone `@webjsdev/intellisense` (Phase 3, #386). Never
   depend on a Lit treesitter/LSP plugin.
2. **Highlighting needs no `setup()`.** The queries auto-load from the
   runtimepath. `setup()` only registers commands and applies config, so it
   must stay optional.
3. **Never break the user's editor.** Lua must not error at load; guard
   risky calls (the `check` job, parser probes) with `pcall` and surface
   problems via `vim.notify`, never a raw error.
4. **`${…}` substitutions** render as injected-language text, not re-scoped
   TypeScript (a treesitter injection limitation). Do not claim otherwise in
   docs; the VS Code extension is the precise path.

## Tests

`test/selftest.lua` is the real suite: it runs inside headless Neovim (the
only place the Lua + treesitter injections execute), asserting the modules
load, `:WebjsCheck` registers, `with_tsserver_plugin` is idempotent,
`check.project` builds quickfix entries, and each tagged template injects the
right parser. `test/nvim.test.mjs` wraps it for the repo's `npm test` and
SKIPS when `nvim` is not installed (so CI without Neovim stays green). Run
directly with `nvim --headless -l packages/editors/nvim/test/selftest.lua`.

## Publishing

Developed here; published to the standalone `webjsdev/webjs.nvim` repo (a git
subtree split) so lazy.nvim / packer can install it by repo name. See
`PUBLISHING.md`.

It is NOT an npm package, but it IS tracked in the unified changelog (#413).
`package.json` exists here ONLY as the version source: bump its `version`
and the pre-commit gate requires a `changelog/nvim/<version>.md` (backfill
generates it). The entry carries `npm: false`, so the `publish-*` scripts
skip the registry while the version still renders on the website
`/changelog` feed. Keep `package.json`'s `version` in step with the
`webjsdev/webjs.nvim` git tag.

---

Framework-wide rules and full API reference:

@../../AGENTS.md
