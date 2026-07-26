# Publishing the `webjs` extension

The extension ships to **two** registries so it is discoverable in every
target editor:

| Registry | Reached by | Tool |
|---|---|---|
| **Visual Studio Marketplace** | VSCode | [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce) |
| **Open VSX** | Cursor, Antigravity, Windsurf, VSCodium | [`ovsx`](https://github.com/eclipse/openvsx/tree/master/cli) |

Both are invoked via `npx`, so there is nothing to add to the repo's
dependencies.

## One-time setup

### Visual Studio Marketplace

1. The publisher id is `webjsdev` (set in `package.json`). Create the
   publisher once at <https://marketplace.visualstudio.com/manage>,
   signing in with the Microsoft / Azure DevOps account that should own
   it.
2. Create a **Personal Access Token** in Azure DevOps
   (<https://dev.azure.com>) for the same account: All accessible
   organizations, scope **Marketplace > Manage**. Copy the token.
3. Authenticate locally:
   ```sh
   npx --yes @vscode/vsce login webjsdev
   # paste the PAT when prompted
   ```

### Open VSX

1. Sign in at <https://open-vsx.org> with GitHub and create the
   `webjsdev` namespace:
   ```sh
   npx --yes ovsx create-namespace webjsdev -p <OPEN_VSX_TOKEN>
   ```
2. Generate an access token from your Open VSX user settings. Export it
   (or pass `-p`):
   ```sh
   export OVSX_PAT=<OPEN_VSX_TOKEN>
   ```

## Releasing a version

1. Bump `version` in `packages/editors/vscode/package.json`. The pre-commit hook
   TRACKS this package (#413), so the bump DOES require a `changelog/vscode/<version>.md`
   and `scripts/backfill-changelog.js` generates one. The entry carries
   `npm: false`, which makes every publish script skip it, so nothing is
   published automatically: the `vsce` / `ovsx` steps below are still manual.
2. Build + package + publish to both registries:
   ```sh
   cd packages/editors/vscode

   # VS Marketplace (builds the vendored plugin + packages from a clean
   # staging dir, then uploads):
   npm run publish:vsce

   # Open VSX (re-uses the packaged webjs.vsix):
   npm run package
   npm run publish:ovsx
   ```
   `publish:vsce` and `package` both run `scripts/package.mjs`, which
   builds the self-contained tsserver plugin and packages from a
   standalone dir so the vsix stays small (see `AGENTS.md`).
3. Verify the listings:
   - <https://marketplace.visualstudio.com/items?itemName=webjsdev.webjs>
   - <https://open-vsx.org/extension/webjsdev/webjs>

## Local install without a registry

The packaged vsix installs directly in any build:

```sh
npm run package
code --install-extension webjs.vsix     # `code` works for VSCode and Code-OSS
```

Cursor / Windsurf / VSCodium accept the same `--install-extension` flag
with their own CLI binary (`cursor`, `windsurf`, `codium`).

## CI note

A future GitHub Actions job can run `npm run publish:vsce` and
`npm run publish:ovsx` on a tag, with `VSCE_PAT` and `OVSX_PAT` stored
as repository secrets. Not wired yet; publish manually until then.
