/**
 * Doc -> source consistency gate (#808).
 *
 * Minimalist / local AI models building webjs apps trust the agent-facing docs
 * (AGENTS.md + the skill) plus the greppable no-build source, NOT training
 * data. So a doc that names a `@webjsdev/*` export the shipped source does not
 * have lures the doc-trusting agent into a rewrite loop. This gate asserts that
 * every NAMED import of `@webjsdev/core` / `@webjsdev/server` (and their public
 * subpaths) shown in a code fence across the agent-facing docs resolves against
 * the real exported surface (runtime named exports UNION the `.d.ts` declared
 * names, which together cover both value and type exports).
 *
 * v1 is import-name existence only (cheap, high signal). A later pass can check
 * signatures. Counterfactual: add `import { doesNotExist } from '@webjsdev/core'`
 * to any doc fence and this reds, naming the symbol.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// The public specifiers an app-building doc may import from. A doc import of a
// specifier NOT in this list (an app path `#modules/...`, a third-party pkg) is
// ignored: this gate only polices the framework's own surface.
const CORE_SPECIFIERS = [
  '@webjsdev/core',
  '@webjsdev/core/server',
  '@webjsdev/core/directives',
  '@webjsdev/core/context',
  '@webjsdev/core/task',
  '@webjsdev/core/client-router',
  '@webjsdev/core/testing',
];
const SERVER_SPECIFIERS = ['@webjsdev/server', '@webjsdev/server/testing'];
const ALL_SPECIFIERS = new Set([...CORE_SPECIFIERS, ...SERVER_SPECIFIERS]);

/** Runtime named exports of a specifier (empty set if it cannot be imported). */
async function runtimeExports(spec) {
  try {
    const mod = await import(spec);
    return new Set(Object.keys(mod).filter((n) => n !== 'default'));
  } catch {
    return new Set();
  }
}

/**
 * Names DECLARED as exports in a `.d.ts` overlay (covers type-only exports the
 * runtime `Object.keys` misses: Metadata, PageProps, WebjsConfig, ...). Regex
 * over the overlay text: `export { A, B }`, `export type/interface/const/function/
 * class NAME`, and `export { A, B } from '...'`.
 */
async function dtsExports(absDts) {
  let src;
  try { src = await readFile(absDts, 'utf8'); } catch { return new Set(); }
  const names = new Set();
  // export [type] { A, B as C } (with or without `from '...'`)
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, '');
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // export (declare)? type|interface|const|function|class|enum NAME
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:type|interface|const|function|class|enum|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

// Build the authoritative export universe: runtime names (values) UNION the
// hand-authored .d.ts declared names (types + values) across core, server, and
// their subpaths.
async function buildExportUniverse() {
  const universe = new Set();
  for (const spec of ALL_SPECIFIERS) for (const n of await runtimeExports(spec)) universe.add(n);
  const dtsFiles = [
    'packages/core/index.d.ts',
    'packages/core/src/component.d.ts',
    'packages/core/src/metadata.d.ts',
    'packages/core/src/routes.d.ts',
    'packages/core/src/webjs-config.d.ts',
    'packages/core/src/serializable.d.ts',
    'packages/server/index.d.ts',
    'packages/server/src/check.d.ts',
    'packages/server/src/testing.d.ts',
  ];
  for (const rel of dtsFiles) for (const n of await dtsExports(join(ROOT, rel))) universe.add(n);
  return universe;
}

/** Recursively collect files under `dir` matching `re`. */
async function walkFiles(dir, re, out = []) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of ents) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.webjs' || ent.name === 'dist') continue;
      await walkFiles(p, re, out);
    } else if (re.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * The agent- AND user-facing doc corpus. Three surfaces:
 *  - AGENTS.md + the skill references (agent-facing markdown, imports in ``` fences).
 *  - the scaffold's shipped AGENTS.md (ships into every app).
 *  - the docs SITE (`website/app/docs/**`): its code samples
 *    are embedded in `.ts` page template strings, and its own components import
 *    the framework for real. Both must resolve, so the site cannot drift ahead
 *    of the shipped surface (the external documentation the user asked about).
 */
async function docCorpus() {
  const files = [join(ROOT, 'AGENTS.md'), join(ROOT, 'README.md'), join(ROOT, 'packages/cli/templates/AGENTS.md')];
  await walkFiles(join(ROOT, '.agents', 'skills', 'webjs'), /\.md$/, files);
  await walkFiles(join(ROOT, 'website', 'app', 'docs'), /\.(ts|md|mdx)$/, files);
  // Marketing site (its sample-code strings + its own components import the
  // framework) and every package README are first-class doc surfaces too.
  await walkFiles(join(ROOT, 'website'), /\.(ts|md|mdx)$/, files);
  await walkFiles(join(ROOT, 'packages'), /^README\.md$/, files);
  return files;
}

/**
 * Extract `{ name -> [{file, spec}] }` for every NAMED import of a framework
 * specifier in the file. Scans the WHOLE text (not just markdown fences),
 * because the docs-site pages embed their samples inside `.ts` template
 * strings, and the site's own components import the framework directly. Skips
 * namespace + default bindings and strips an inline `type ` prefix (a type
 * specifier still resolves against the universe, which includes type exports).
 */
function extractFrameworkImports(text, relFile, out) {
  // import [type] [Default,] { a, b as c, type D } from '<spec>'
  for (const im of text.matchAll(/\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = im[2];
    if (!ALL_SPECIFIERS.has(spec)) continue;
    for (const part of im[1].split(',')) {
      const raw = part.trim();
      if (!raw) continue;
      // `a as b` -> the EXPORT is `a`; strip an inline `type ` modifier.
      const name = raw.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      (out[name] ||= []).push({ file: relFile, spec });
    }
  }
}

test('every framework import shown in the agent-facing docs resolves to a real export (#808)', async () => {
  const universe = await buildExportUniverse();
  assert.ok(universe.size > 40, `export universe looks too small (${universe.size}); did the imports resolve?`);

  /** @type {Record<string, Array<{file:string, spec:string}>>} */
  const referenced = {};
  for (const abs of await docCorpus()) {
    let md;
    try { md = await readFile(abs, 'utf8'); } catch { continue; }
    extractFrameworkImports(md, abs.replace(ROOT + '/', ''), referenced);
  }

  const unknown = [];
  for (const [name, sites] of Object.entries(referenced)) {
    if (!universe.has(name)) {
      unknown.push(`${name}  (shown in: ${[...new Set(sites.map((s) => `${s.file} <- ${s.spec}`))].join(', ')})`);
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `these @webjsdev/* imports appear in the agent-facing docs but are not exported by the shipped source:\n  ${unknown.join('\n  ')}`,
  );
});
