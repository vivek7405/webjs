/**
 * Bundle the framework docs into `@webjsdev/mcp` so `npx @webjsdev/mcp` is
 * self-contained (#376, #415). The MCP knowledge layer serves the the skill references
 * corpus + the root `AGENTS.md` as resources, but those live at the MONOREPO
 * ROOT, outside this package, so npm's `files` cannot reach them. This script
 * copies them into `packages/mcp/resources/` (which IS in `files`) at `prepack`,
 * just before the tarball is built. `postpack` (clean-mcp-resources.js) removes
 * the working-tree copy right after, so the bundle is transient: present in the
 * tarball, absent in dev (where `resolveDocsLocation` falls back to the live
 * repo-root docs, so source stays single).
 *
 * It also writes `resources/corpus.json`, a build stamp naming the package,
 * version, commit, and copy time the bundle froze (#1319). A published tarball
 * carries a snapshot of the docs forever, so without the stamp a globally
 * installed server has no way to say which docs it is holding.
 *
 * The reusable `bundleDocs(...)` is exported + unit-tested; the script body just
 * runs it against the real repo paths. Mirrors `next-devtools-mcp`'s
 * `copy-resources`. Dependency-free.
 *
 * @module copy-mcp-resources
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when two paths name the same directory, symlinks resolved where possible. */
function sameDir(a, b) {
  if (!a || !b) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

/**
 * The commit `cwd` itself is checked out at, or `null` when that cannot be known.
 *
 * `prepack` can run outside a git checkout (a consumer running `npm pack` inside
 * an extracted tarball, a Docker build with no `.git`), and the `git` binary may
 * be absent entirely, so this never throws and never fails the publish. Copying
 * markdown is this script's job; a missing SHA costs a diagnostic, not a release.
 * `spawnSync` over `execSync` so an absent binary is a returned error object
 * rather than a throw.
 *
 * Three independent things must hold before a SHA is returned, and each rejects a
 * failure the others cannot see:
 *
 * - the exit status, which is how an absent `.git` and a missing binary report;
 * - the 40-hex shape, because a git that exits 0 while printing something else
 *   (a wrapper on PATH, a future porcelain change) must not put that text into a
 *   published tarball as if it were a commit;
 * - `--show-toplevel` matching `cwd`, because `rev-parse` walks UP from `cwd` and
 *   will happily answer from an ancestor. An extracted tarball sitting inside an
 *   unrelated checkout would otherwise stamp the OUTER repo's HEAD as the commit
 *   the docs came from, and that answer is a well-formed SHA, so nothing else
 *   here could reject it. This is the one guard where a wrong answer is worse
 *   than no answer, since it is confidently wrong rather than absent.
 *
 * `spawn` is injectable so each guard is testable independently: the real `git`
 * in a temp dir exits non-zero, so on its own it can only ever reach the first.
 *
 * @param {string} cwd  the directory whose own checkout HEAD is wanted
 * @param {typeof spawnSync} [spawn]  seam for tests; defaults to the real spawnSync
 * @returns {string | null}
 */
export function readGitSha(cwd, spawn = spawnSync) {
  try {
    const out = spawn('git', ['rev-parse', '--show-toplevel', 'HEAD'], { cwd, encoding: 'utf8' });
    if (!out || out.status !== 0 || typeof out.stdout !== 'string') return null;
    const [toplevel, sha] = out.stdout.trim().split('\n').map((line) => line.trim());
    if (!/^[0-9a-f]{40}$/.test(sha || '')) return null;
    return sameDir(toplevel, cwd) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Copy `srcRefs` (a dir of `*.md`) + `srcAgents` + `srcSkill` (single files) into
 * `<destRoot>/references/` + `<destRoot>/AGENTS.md` + `<destRoot>/SKILL.md`. Cleans `destRoot` first so
 * a removed/renamed doc never lingers in the bundle. PURE side effect on the
 * given paths, so it is testable against temp dirs without touching the package.
 *
 * With a `stamp`, also writes `<destRoot>/corpus.json`, the build stamp that
 * identifies WHICH docs this tarball froze (#1319). It sits beside `AGENTS.md`
 * rather than inside `references/`, so `catalogue()` (which lists only `*.md`
 * under the references dir) can never surface build metadata as a readable doc.
 * `stamp` is optional so the function stays pure over its arguments.
 *
 * @param {{ srcRefs: string, srcAgents: string, srcSkill: string, destRoot: string, stamp?: object }} paths
 * @returns {void}
 */
export function bundleDocs({ srcRefs, srcAgents, srcSkill, destRoot, stamp }) {
  const destRefs = join(destRoot, 'references');
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRefs, { recursive: true });
  cpSync(srcRefs, destRefs, { recursive: true });
  copyFileSync(srcAgents, join(destRoot, 'AGENTS.md'));
  copyFileSync(srcSkill, join(destRoot, 'SKILL.md'));
  if (stamp) writeFileSync(join(destRoot, 'corpus.json'), JSON.stringify(stamp, null, 2) + '\n');
}

/** Run against the real repo paths when invoked as the prepack script. */
function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = resolve(here, '..'); // packages/mcp/scripts -> packages/mcp
  const repoRoot = resolve(here, '..', '..', '..'); // -> monorepo root
  const skill = join(repoRoot, '.agents', 'skills', 'webjs');
  // Both identity fields come from the manifest that is about to be packed, so a
  // rename cannot leave the stamp naming the wrong package. An unreadable
  // manifest yields nulls, never a plausible-looking default: the whole point of
  // a provenance stamp is that a consumer can tell a real answer from no answer,
  // and a fabricated "0.0.0" is indistinguishable from a genuine version.
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  } catch (err) {
    console.error(`[webjs] could not read the package manifest for the corpus stamp: ${err.message}`);
  }
  const stamp = {
    package: pkg.name || null,
    version: pkg.version || null,
    // Full 40 chars, never abbreviated: a short SHA is ambiguous by definition
    // and a consumer can always shorten it for display.
    sha: readGitSha(repoRoot),
    copiedAt: new Date().toISOString(),
  };
  bundleDocs({
    srcRefs: join(skill, 'references'),
    srcAgents: join(repoRoot, 'AGENTS.md'),
    srcSkill: join(skill, 'SKILL.md'),
    destRoot: join(pkgRoot, 'resources'),
    stamp,
  });
  // Diagnostics to stderr so they never pollute a tool parsing `npm pack --json` stdout.
  console.error('[webjs] bundled MCP knowledge into resources/ (references + SKILL.md + AGENTS.md)');
  console.error(
    `[webjs] corpus stamp: ${stamp.package || 'unknown'}@${stamp.version || 'unknown'} sha=${stamp.sha || 'unknown'} copiedAt=${stamp.copiedAt}`,
  );
}

// Only run the side effect when invoked directly (not when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
