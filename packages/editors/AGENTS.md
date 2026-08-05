# AGENTS.md for `packages/editors/` (the editor suite)

Three packages give webjs its editor intelligence. They form a
**source-of-truth plus two distributions** shape, so a change in one often
obligates work in another. This file is the map; each package's own
`AGENTS.md` + `PUBLISHING.md` holds the detail.

Framework-wide rules live in the root [`../../AGENTS.md`](../../AGENTS.md).

## The three packages

| Dir | Package | What it is | Ships to |
|---|---|---|---|
| `intellisense/` | `@webjsdev/intellisense` (npm) | The standalone tsserver plugin: in-template completions, diagnostics, go-to-definition, hover. **The SOURCE OF TRUTH for all editor intelligence.** | npm |
| `vscode/` | `webjs` extension | VS Code / Cursor / Windsurf / Antigravity extension. Highlighting (TextMate grammars) + snippets + commands, and it **bundles** intellisense. | VS Marketplace + Open VSX |
| `nvim/` | `webjs.nvim` | Neovim plugin. Treesitter highlighting + `:WebjsCheck` + an LSP helper, and it **vendors** intellisense. | a standalone GitHub repo (`webjsdev/webjs.nvim`) |

Both editor plugins carry their OWN copy of the intellisense plugin (a Neovim
plugin has no `npm install`; the VS Code vsix must be self-contained), but they
obtain that copy differently, which is the crux of the dev flow below.

## Development flow

### Editing intellisense behaviour (the language service)

Edit `intellisense/src/` (the parser, tag/attr resolution, completions,
diagnostics, hover). It is the only place this logic lives. Then propagate to
both consumers:

- **nvim** keeps a COMMITTED verbatim copy at
  `nvim/vendor/node_modules/@webjsdev/intellisense/`. It is GENERATED, never
  hand-edited. After ANY `intellisense/src/` change, OR any edit to
  `intellisense/package.json` INCLUDING a release version bump, you MUST
  re-vendor before pushing:
  ```sh
  node packages/editors/nvim/scripts/vendor-intellisense.mjs
  git add -f packages/editors/nvim/vendor   # the copy is under a gitignored node_modules/
  ```
  The drift guard `nvim/test/vendor-sync.test.mjs` FAILS the "Unit + integration"
  CI job whenever the copy and the source diverge (whether you forgot to
  re-vendor, or hand-edited the copy). It compares `src/` byte for byte
  ("vendored intellisense src is byte-identical ...") AND the manifest in
  full, `version` included, so a release that bumps intellisense must re-vendor
  on the release branch. #1117 had to fix that drift by hand after the copy
  spent 140 commits misreporting the version the plugin ships.
  Confirm: `node --test packages/editors/nvim/test/vendor-sync.test.mjs`.
- **vscode** rebuilds its bundle from `intellisense/` with esbuild at vsix
  package time (`vscode/scripts/build.mjs`, run by `package.mjs`), so it picks
  up `src/` changes automatically. Nothing to commit, but confirm the bundle
  still builds (`npm run package` in `packages/editors/vscode`) for a behaviour
  change.

### Editing grammars / queries / snippets / commands

These are per-plugin and do NOT share code. A change to recognised tags or hole
scoping must be mirrored by hand in BOTH plugins, with each plugin's test:

- VS Code TextMate grammars `vscode/syntaxes/webjs-{html,css,svg}.json` and
  snippets `vscode/snippets/webjs.json`, tested by `vscode/test/extension.test.mjs`.
- Neovim treesitter queries `nvim/queries/{typescript,javascript}/injections.scm`
  and Lua commands `nvim/lua/webjs/`, tested by `nvim/test/selftest.lua`.

### Editing the nvim package itself

`nvim/` is **developed here** but **installed by users from a separate repo**,
`webjsdev/webjs.nvim`, which is a git-subtree split of this directory (lazy.nvim
/ packer clone a whole repo by name, so a monorepo subdir is not directly
installable). So a change to `nvim/` (Lua, queries, or the vendored copy) is not
live for users until the split is re-run and force-pushed on release (see
Publishing). Do not hand-edit `nvim/vendor/` (it is the generated intellisense
copy, above).

## Publishing (on a release)

- **`@webjsdev/intellisense`**: a normal monorepo npm package. Bump
  `intellisense/package.json`, let the changelog flow run, publish to npm via
  the standard release. A bump is a real publish because the scaffold pins it in
  app `node_modules` + `tsconfig`.
- **`webjs` (VS Code)**: bump `vscode/package.json`, then
  `npm run publish:vsce` (VS Marketplace) and `npm run publish:ovsx` (Open VSX),
  both of which package a fresh self-contained bundle. NOT npm. Full steps +
  one-time auth in [`vscode/PUBLISHING.md`](./vscode/PUBLISHING.md).
- **`webjs.nvim`**: split `packages/editors/nvim` and force-push it to the
  standalone repo, then tag a GitHub release (no registry):
  ```sh
  git subtree split --prefix=packages/editors/nvim -b nvim-release
  git push --force git@github.com:webjsdev/webjs.nvim.git nvim-release:main
  git branch -D nvim-release
  ```
  Re-vendor the intellisense copy FIRST so the split carries a current copy.
  Full steps in [`nvim/PUBLISHING.md`](./nvim/PUBLISHING.md).

## Per-package detail

- [`intellisense/AGENTS.md`](./intellisense/AGENTS.md) (the plugin internals + the re-vendor rule)
- [`vscode/AGENTS.md`](./vscode/AGENTS.md) + [`vscode/PUBLISHING.md`](./vscode/PUBLISHING.md)
- [`nvim/AGENTS.md`](./nvim/AGENTS.md) + [`nvim/PUBLISHING.md`](./nvim/PUBLISHING.md)
