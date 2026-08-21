#!/usr/bin/env node
/**
 * Publish ONE package version to npm, driven by a changelog file.
 *
 *   node scripts/publish-npm.js changelog/core/0.6.0.md
 *
 * The companion to scripts/publish-release.js. Same idempotency
 * shape: parse the file's frontmatter, derive package + version,
 * check whether that version is already on the npm registry, skip
 * if yes, publish if no.
 *
 * It ALSO skips when the workspace's package.json has moved past the
 * version this file names, because `npm publish` ships the tree's
 * version rather than the changelog's. That only matters on the
 * `republish_paths` recovery path in .github/workflows/release.yml,
 * where an older changelog file can be named deliberately; on the
 * normal release path the bump and its changelog land in one commit,
 * so the two are always equal.
 *
 * Auth: relies on the standard `npm publish` token resolution
 * (NODE_AUTH_TOKEN env var via setup-node's .npmrc on CI, or
 * `npm login` locally). The script does not write any .npmrc.
 *
 * The workspace flag (`--workspace=@webjsdev/<pkg>`) tells npm to
 * publish that specific package out of the monorepo. `--access public`
 * is a belt-and-braces alongside the per-package
 * `publishConfig: { access: "public" }`, in case a package forgot
 * to set it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/publish-npm.js <changelog/<pkg>/<version>.md>');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`[publish-npm] file not found: ${file}`);
  process.exit(2);
}

const raw = readFileSync(resolve(file), 'utf8');
const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!m) {
  console.error(`[publish-npm] ${file}: no frontmatter block`);
  process.exit(2);
}
const fm = {};
for (const line of m[1].split('\n')) {
  const idx = line.indexOf(':');
  if (idx < 0) continue;
  const k = line.slice(0, idx).trim();
  let v = line.slice(idx + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  fm[k] = v;
}

// Non-npm packages (the editor extensions: the VS Code extension ships via
// vsce/ovsx, webjs.nvim via the git subtree) are tracked in the changelog
// for the /changelog feed but carry `npm: false`, so there is nothing to
// publish to the registry. Skip cleanly so a vscode/nvim release does not
// fail the workflow.
if (fm.npm === 'false') {
  console.log(`[publish-npm] skip ${fm.package || file}: npm:false (non-npm package)`);
  process.exit(0);
}

const pkgName = fm.package; // "@webjsdev/core"
const version = fm.version;
if (!pkgName || !version) {
  console.error(`[publish-npm] ${file}: missing package or version in frontmatter`);
  process.exit(2);
}

// The version `npm publish` actually ships is the one in the WORKSPACE's
// package.json, never the one this changelog file is named for. Those agree
// on the normal release path, where the bump and its generated changelog land
// in the same commit, so nothing here ever noticed they were two different
// numbers. They diverge the moment an OLDER changelog file is republished,
// and the old code published the tree's version while logging the changelog's:
// republishing changelog/core/0.7.52.md shipped 0.7.53 under the line
// `published @webjsdev/core@0.7.52`, and the next file in the batch then died
// with `E403 cannot publish over the previously published versions: 0.7.53`,
// taking every remaining package with it under `set -e`.
//
// So refuse to publish when the tree has moved on. Resolve the version through
// the SAME `--workspace=` lookup `npm publish` uses, rather than guessing the
// directory from the package name, so this compares exactly what would be sent
// (`packages/<pkg>` for most, `packages/editors/intellisense` and
// `packages/wrappers/*` for the rest).
//
// This runs BEFORE the registry check, so it needs no network: a version whose
// source is gone cannot be published whatever the registry says.
const treeView = spawnSync(
  'npm', ['pkg', 'get', 'version', `--workspace=${pkgName}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
let treeVersion = null;
if (treeView.status === 0) {
  try {
    const parsed = JSON.parse(treeView.stdout);
    // `npm pkg get --workspace=` answers `{"<name>": "<version>"}`; a bare
    // string is accepted too in case that shape ever changes.
    treeVersion = typeof parsed === 'string' ? parsed : parsed[pkgName];
  } catch {
    // Unparseable output is not proof of a mismatch, so fall through and let
    // the publish itself decide. Failing open here keeps a workspace-resolution
    // quirk from blocking a release that would otherwise be fine.
  }
}
if (treeVersion && treeVersion !== version) {
  console.log(
    `[publish-npm] skip ${pkgName}@${version}: the workspace holds ${treeVersion}, ` +
    `so ${version} can no longer be published from this tree ` +
    `(publishing would ship ${treeVersion} under the wrong name)`,
  );
  process.exit(0);
}

// Idempotency: is this version already on the registry?
// `npm view <pkg>@<version> version` prints the version on success,
// non-zero exit on 404. We swallow stderr to avoid noisy "E404" log.
const view = spawnSync(
  'npm', ['view', `${pkgName}@${version}`, 'version'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
if (view.status === 0 && view.stdout.trim() === version) {
  console.log(`[publish-npm] skip ${pkgName}@${version}: already on registry`);
  process.exit(0);
}

// Publish. --workspace targets the package within the monorepo, so we
// can run this from the repo root without cd'ing into packages/<pkg>/.
const pub = spawnSync(
  'npm',
  ['publish', `--workspace=${pkgName}`, '--access=public', '--ignore-scripts=false'],
  { stdio: 'inherit' },
);
if (pub.status !== 0) {
  console.error(`[publish-npm] npm publish failed for ${pkgName}@${version}`);
  process.exit(pub.status || 1);
}
// Report the version that was actually SHIPPED, not the one this file is named
// for. The guard above makes them equal, so this is belt and braces: the old
// line took its number from the changelog filename unconditionally, which is
// what let a publish of the wrong version read as a success in the log.
console.log(`[publish-npm] published ${pkgName}@${treeVersion ?? version} (${basename(file)})`);
