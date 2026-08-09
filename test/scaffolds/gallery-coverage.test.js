// Scaffold teaching-coverage gate (the tier-2, un-skippable enforcement).
//
// The `require-scaffold-with-src.sh` commit hook is only a FLOOR: it blocks a
// feature commit that stages NO scaffold surface, but it cannot tell a real
// demo from a doc bullet, so a new API can ship documented-but-undemoed (the
// #848 gap: forbidden()/unauthorized() got app-tree bullets, no gallery demo).
//
// This test is the missing tier-2: it runs on every `npm test` (and in CI),
// reconciles the LIVE framework surface against the hand-curated
// test/scaffolds/gallery-coverage.json manifest, and FAILS when something new is
// neither demoed nor exempted. So the moment someone adds a surface, CI is red
// until they either add a demo or consciously exempt it with a reason. That is
// the same shape as tests: existence is machine-enforced here, and whether the
// demo/exemption is honest is a code-review concern on the PR.
//
// Three surfaces are gated:
//   1. @webjsdev/core exports   -> a { demo } pointing at a gallery file that references it.
//   2. @webjsdev/server exports -> { demoed: true } verified by a generated app importing it.
//   3. routing convention files -> the stems the router parses (page/layout/error/
//      loading/not-found/forbidden/unauthorized/global-*/route + metadata), each
//      demonstrated by a file in a generated app, or exempted.
// The convention stems are DERIVED from packages/server/src/router.js source, so a
// new `stem === '...'` branch auto-appears and forces classification.
//
// The reconcile*() cores are pure functions so the failure modes are proven with
// SYNTHETIC inputs (a new name, a stale key, a missing demo, an empty reason)
// without mutating the framework, plus assertions over the REAL surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as core from '@webjsdev/core';
import * as server from '@webjsdev/server';
import { scaffoldApp } from '../../packages/cli/lib/create.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const GALLERY = existsSync(join(REPO, 'packages', 'cli', 'templates', 'gallery'))
  ? join(REPO, 'packages', 'cli', 'templates', 'gallery')
  : join(REPO, 'gallery');
const MANIFEST_PATH = join(__dirname, 'gallery-coverage.json');
const ROUTER_SRC = join(REPO, 'packages', 'server', 'src', 'router.js');

/**
 * Pure reconciliation. Returns a list of human-readable error strings; empty
 * means fully covered. Injectable file predicates so synthetic cases need no fs.
 *
 * @param {string[]} liveExports  the real export names
 * @param {{ exports: Record<string, {demo?: string, exempt?: string}> }} manifest
 * @param {(rel: string) => boolean} demoFileExists  gallery-relative path -> exists?
 * @param {(rel: string, sym: string) => boolean} demoFileTeaches  file mentions the symbol as a word?
 */
export function reconcile(liveExports, manifest, demoFileExists, demoFileTeaches) {
  const errors = [];
  const entries = manifest.exports || {};
  const classified = new Set(Object.keys(entries));
  const live = new Set(liveExports);

  // 1. Every live export MUST be classified (the tier-2 teeth: a new export fails).
  for (const name of liveExports) {
    if (!classified.has(name)) {
      errors.push(
        `unclassified export "${name}": add a { demo } (a runnable gallery example) ` +
        `or an { exempt } (reason "internal: ..." or "deferred: ...") to ` +
        `test/scaffolds/gallery-coverage.json. The scaffold is the primary teaching ` +
        `surface, so a new @webjsdev/core export must be demoed or consciously exempted.`,
      );
    }
  }

  // 2. No stale manifest keys (export removed or renamed).
  for (const name of classified) {
    if (!live.has(name)) {
      errors.push(`stale manifest entry "${name}": no longer a @webjsdev/core export, remove or rename it.`);
    }
  }

  // 3. Per-entry shape + demo integrity.
  for (const [name, entry] of Object.entries(entries)) {
    if (!live.has(name)) continue; // already reported as stale
    const hasDemo = typeof entry.demo === 'string' && entry.demo.length > 0;
    const hasExempt = typeof entry.exempt === 'string' && entry.exempt.trim().length > 0;
    if (hasDemo === hasExempt) {
      errors.push(`entry "${name}" must have exactly one of { demo } or a non-empty { exempt }.`);
      continue;
    }
    if (hasDemo) {
      if (!demoFileExists(entry.demo)) {
        errors.push(`demo for "${name}" points at "${entry.demo}", which does not exist under the gallery.`);
      } else if (!demoFileTeaches(entry.demo, name)) {
        errors.push(`demo for "${name}" ("${entry.demo}") does not reference "${name}"; point at a file that actually uses it.`);
      }
    }
  }
  return errors;
}

/**
 * Reconcile a { demoed: true | exempt } section against the set of names the
 * scaffold actually demonstrates. Used for @webjsdev/server exports (demonstrated
 * = imported by a generated app) and routing convention files (demonstrated = a
 * file of that stem exists in a generated app).
 *
 * @param {string[]} liveNames
 * @param {Record<string, {demoed?: boolean, exempt?: string}>} entries
 * @param {Set<string>} demonstrated  names the generated apps actually show
 * @param {string} kind  label for error messages
 */
export function reconcileSet(liveNames, entries, demonstrated, kind) {
  const errors = [];
  const classified = new Set(Object.keys(entries));
  const live = new Set(liveNames);

  // 1. Every live name MUST be classified (the tier-2 teeth).
  for (const name of liveNames) {
    if (!classified.has(name)) {
      errors.push(
        `unclassified ${kind} "${name}": add { demoed: true } (the scaffold demonstrates it) ` +
        `or { exempt } (reason "internal: ..." or "deferred: ...") to test/scaffolds/gallery-coverage.json.`,
      );
    }
  }
  // 2. No stale entries.
  for (const name of classified) {
    if (!live.has(name)) errors.push(`stale ${kind} entry "${name}": no longer present, remove or rename it.`);
  }
  // 3. Shape + over-claim check. A { demoed: true } that the scaffold does NOT
  //    actually demonstrate is a false claim and fails; an exempt name the
  //    scaffold happens to demonstrate is a safe under-claim (not failed).
  for (const [name, entry] of Object.entries(entries)) {
    if (!live.has(name)) continue;
    const hasDemoed = entry.demoed === true;
    const hasExempt = typeof entry.exempt === 'string' && entry.exempt.trim().length > 0;
    if (hasDemoed === hasExempt) {
      errors.push(`${kind} "${name}" must have exactly one of { demoed: true } or a non-empty { exempt }.`);
      continue;
    }
    if (hasDemoed && !demonstrated.has(name)) {
      errors.push(`${kind} "${name}" is marked demoed but no generated app demonstrates it; add a real demo or exempt it.`);
    }
  }
  return errors;
}

// Derive the routing convention stems from the router source, so a new
// `stem === '...'` branch (or METADATA_STEMS entry) auto-appears and must be
// classified. This is the convention-file analogue of Object.keys(core).
function deriveConventionStems() {
  const src = readFileSync(ROUTER_SRC, 'utf8');
  const stems = new Set([...src.matchAll(/stem === '([a-z-]+)'/g)].map((m) => m[1]));
  const meta = (src.match(/METADATA_STEMS = new Set\(\[([^\]]*)\]/) || [])[1] || '';
  for (const m of meta.matchAll(/'([a-z-]+)'/g)) stems.add(m[1]);
  return [...stems].sort();
}

// Generate one app per template (files only) and report which @webjsdev/server
// names they import and which convention-file stems they contain. Memoized so
// the three generations happen once for the whole suite.
let _analysis = null;
function scaffoldAnalysis() {
  if (_analysis) return _analysis;
  _analysis = (async () => {
    const base = mkdtempSync(join(tmpdir(), 'webjs-coverage-'));
    const serverNames = new Set();
    const conventions = new Set();
    const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@webjsdev\/server[^'"]*['"]/g;
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const f = join(d, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        conventions.add(basename(f).replace(/\.(ts|js|mts|mjs)$/, ''));
        let src;
        try { src = readFileSync(f, 'utf8'); } catch { continue; }
        let m;
        while ((m = importRe.exec(src))) {
          for (let n of m[1].split(',')) {
            n = n.trim().split(/\s+as\s+/)[0].trim();
            if (n) serverNames.add(n);
          }
        }
      }
    };
    try {
      for (const t of ['full-stack', 'api']) {
        // scaffoldApp(name, parentDir) writes parentDir/name.
        await scaffoldApp(t, base, { template: t, install: false });
        walk(join(base, t));
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    return { serverNames, conventions };
  })();
  return _analysis;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const liveExports = Object.keys(core);

const realDemoExists = (rel) => existsSync(join(GALLERY, rel));
const wordRe = (sym) => new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
const realDemoTeaches = (rel, sym) => {
  try { return wordRe(sym).test(readFileSync(join(GALLERY, rel), 'utf8')); }
  catch { return false; }
};

test('every @webjsdev/core export is demoed in the gallery or consciously exempted', () => {
  const errors = reconcile(liveExports, manifest, realDemoExists, realDemoTeaches);
  const demoed = Object.values(manifest.exports).filter((e) => e.demo).length;
  const internal = Object.values(manifest.exports).filter((e) => e.exempt?.startsWith('internal:')).length;
  const deferred = Object.entries(manifest.exports).filter(([, e]) => e.exempt?.startsWith('deferred:'));
  // Visibility: print the coverage split and the deferred (agent-facing, not-yet-demoed) list every run.
  console.log(
    `[scaffold-coverage] ${liveExports.length} @webjsdev/core exports: ` +
    `${demoed} demoed, ${internal} internal-exempt, ${deferred.length} deferred (agent-facing, not yet demoed).`,
  );
  if (deferred.length) console.log('[scaffold-coverage] deferred: ' + deferred.map(([n]) => n).sort().join(', '));
  assert.deepEqual(errors, [], `scaffold teaching-coverage gaps:\n  - ${errors.join('\n  - ')}`);
});

test('reconcile FAILS on a new unclassified export (the tier-2 teeth)', () => {
  const errors = reconcile(
    [...liveExports, 'brandNewFeature'],
    manifest,
    realDemoExists,
    realDemoTeaches,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unclassified export "brandNewFeature"/);
});

test('reconcile FAILS on a stale manifest entry (export removed/renamed)', () => {
  const shrunk = liveExports.filter((n) => n !== 'html');
  const errors = reconcile(shrunk, manifest, realDemoExists, realDemoTeaches);
  assert.ok(errors.some((e) => /stale manifest entry "html"/.test(e)), errors.join('\n'));
});

test('reconcile FAILS when a demo pointer references a missing file', () => {
  const m = { exports: { html: { demo: 'app/features/gone/page.ts' } } };
  const errors = reconcile(['html'], m, () => false, () => false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not exist under the gallery/);
});

test('reconcile FAILS when a demo file does not actually reference the symbol', () => {
  const m = { exports: { html: { demo: 'app/features/x/page.ts' } } };
  const errors = reconcile(['html'], m, () => true, () => false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not reference "html"/);
});

test('reconcile FAILS on an empty exemption reason', () => {
  const m = { exports: { html: { exempt: '   ' } } };
  const errors = reconcile(['html'], m, () => true, () => true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exactly one of \{ demo \} or a non-empty \{ exempt \}/);
});

// ---------------------------------------------------------------------------
// Gap 2: @webjsdev/server exports. Demonstrated = imported by a generated app.
// ---------------------------------------------------------------------------

const liveServer = Object.keys(server);

test('every @webjsdev/server export is demonstrated by the scaffold or exempted', async () => {
  const { serverNames } = await scaffoldAnalysis();
  const entries = manifest.serverExports || {};
  const errors = reconcileSet(liveServer, entries, serverNames, 'server export');
  const demoed = Object.values(entries).filter((e) => e.demoed).length;
  const internal = Object.values(entries).filter((e) => e.exempt?.startsWith('internal:')).length;
  const deferred = Object.entries(entries).filter(([, e]) => e.exempt?.startsWith('deferred:'));
  console.log(
    `[scaffold-coverage] ${liveServer.length} @webjsdev/server exports: ` +
    `${demoed} demoed, ${internal} internal-exempt, ${deferred.length} deferred.`,
  );
  if (deferred.length) console.log('[scaffold-coverage] server deferred: ' + deferred.map(([n]) => n).sort().join(', '));
  assert.deepEqual(errors, [], `server-export coverage gaps:\n  - ${errors.join('\n  - ')}`);
});

// ---------------------------------------------------------------------------
// Gap 1: routing convention files. Stems derived from router.js source;
// demonstrated = a file of that stem exists in a generated app.
// ---------------------------------------------------------------------------

const conventionStems = deriveConventionStems();

test('every routing convention file the router parses is demonstrated or exempted', async () => {
  const { conventions } = await scaffoldAnalysis();
  const entries = manifest.conventions || {};
  const errors = reconcileSet(conventionStems, entries, conventions, 'convention file');
  const demoed = Object.values(entries).filter((e) => e.demoed).length;
  const deferred = Object.entries(entries).filter(([, e]) => e.exempt?.startsWith('deferred:'));
  console.log(
    `[scaffold-coverage] ${conventionStems.length} routing convention files: ` +
    `${demoed} demonstrated, ${deferred.length} deferred.`,
  );
  if (deferred.length) console.log('[scaffold-coverage] convention deferred: ' + deferred.map(([n]) => n).sort().join(', '));
  assert.deepEqual(errors, [], `convention-file coverage gaps:\n  - ${errors.join('\n  - ')}`);
});

test('deriveConventionStems finds the #848 boundary stems (source is parseable)', () => {
  for (const stem of ['page', 'layout', 'not-found', 'forbidden', 'unauthorized', 'global-error', 'global-not-found']) {
    assert.ok(conventionStems.includes(stem), `expected router to parse "${stem}" (got: ${conventionStems.join(', ')})`);
  }
});

test('reconcileSet FAILS on a new unclassified name (the tier-2 teeth)', () => {
  const errors = reconcileSet(['broadcast', 'brandNewApi'], { broadcast: { demoed: true } }, new Set(['broadcast']), 'server export');
  assert.ok(errors.some((e) => /unclassified server export "brandNewApi"/.test(e)), errors.join('\n'));
});

test('reconcileSet FAILS when a name is marked demoed but nothing demonstrates it', () => {
  const errors = reconcileSet(['broadcast'], { broadcast: { demoed: true } }, new Set(), 'server export');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /marked demoed but no generated app demonstrates it/);
});

test('reconcileSet FAILS on a stale entry and on an empty exemption', () => {
  const stale = reconcileSet([], { gone: { exempt: 'internal: x' } }, new Set(), 'server export');
  assert.ok(stale.some((e) => /stale server export entry "gone"/.test(e)), stale.join('\n'));
  const empty = reconcileSet(['x'], { x: { exempt: '  ' } }, new Set(), 'server export');
  assert.match(empty[0], /exactly one of \{ demoed: true \}/);
});
