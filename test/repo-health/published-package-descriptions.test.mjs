/**
 * The `description` of every published package is a search surface (#1100).
 *
 * npmjs.com ranks well for framework names, and the `description` field is
 * exactly what renders as the result snippet. Every description used to say
 * what THAT package does without ever saying what the project is, so a
 * stranger landing on @webjsdev/core from a search learned that it ships
 * "html/css tags" and never learned this is a web framework at all.
 *
 * Two of the descriptions also violated AGENTS.md invariant 11 (the brand
 * written lowercase in prose, and a space-hyphen used as pause punctuation).
 * The prose hook never caught them because it scans only NEW content, and
 * these predate it.
 *
 * So this asserts the invariant across EVERY published package at once rather
 * than per package. The package list is DERIVED (every non-private manifest
 * under the three workspace base dirs), so a new published package is covered
 * the moment it lands instead of when someone remembers to add it here.
 *
 * Note the descriptions on npmjs.com only change when a package is
 * REPUBLISHED. npm renders them from the published tarball's manifest, not
 * from this repository, so this test guards the source of truth for the next
 * release rather than what is live right now.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Same three base dirs the publish script probes (see published-package-dirs).
const BASES = ['packages', 'packages/editors', 'packages/wrappers'];

// Built from its code point rather than typed. A literal one in this file
// would be the very glyph the assertion forbids, and the repo prose hook
// rejects any tool call carrying it.
const EM_DASH = String.fromCharCode(0x2014);

/**
 * Every manifest under the workspace base dirs that npm actually publishes.
 * `private: true` marks the ones that never reach the registry (the editor
 * plugins, the ui sub-apps), and those carry no search surface.
 */
function publishedManifests() {
  const out = [];
  for (const base of BASES) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.private) continue;
      out.push({ rel: `${base}/${entry.name}/package.json`, name: pkg.name, description: pkg.description });
    }
  }
  return out;
}

const PKGS = publishedManifests();

/** The subcommands the CLI really has, so `webjs dev` reads as a command. */
const CLI_SUBCOMMANDS =
  'create|dev|start|test|check|routes|db|ui|doctor|types|typecheck|mcp|vendor|help|version|add|init|generate|migrate|push|studio|seed|pin|unpin|list|audit|outdated|update|view|diff|info|build';

/**
 * Strip inline code spans, the way the prose hook does, so a literal
 * `webjs` command or `npm create webjs@latest my-app` is never read as brand
 * prose. What is left is the sentence a search result actually shows.
 */
const prose = (s) => s.replace(/`[^`]*`/g, '');

/** The opening sentence, which is the part a truncated snippet still shows. */
const firstSentence = (s) => s.split(/(?<=\.)\s/)[0];

test('the derived package list is not silently empty', () => {
  // A broken probe would make every assertion below vacuously pass.
  assert.ok(PKGS.length >= 8, `expected the published packages, found ${PKGS.length}`);
  for (const p of PKGS) assert.ok(p.name, `${p.rel} has a name`);
});

for (const pkg of PKGS) {
  test(`${pkg.name}: the description opens by saying what the project is`, () => {
    assert.ok(pkg.description, `${pkg.rel} has a description`);
    const opening = firstSentence(pkg.description);
    // Both halves matter. The brand alone ("The runtime for WebJs") still
    // leaves a stranger not knowing what WebJs is, and the category alone
    // ("a full-stack framework") does not attach it to this project.
    assert.match(opening, /WebJs/, `the first sentence names the project: ${opening}`);
    assert.match(opening, /framework/i, `the first sentence states the category: ${opening}`);
  });

  test(`${pkg.name}: the description writes the brand as a proper noun`, () => {
    const scan = prose(pkg.description);
    const hits = [...scan.matchAll(/(^|[^A-Za-z0-9@._/-])webjs(\s+[A-Za-z]|\.(\s|$))/g)]
      .filter((m) => !new RegExp(`^\\s+(${CLI_SUBCOMMANDS})(\\s|$)`).test(m[2]));
    assert.deepEqual(
      hits.map((m) => m[0].trim()),
      [],
      `${pkg.rel} writes the brand lowercase in prose, and it is "WebJs" wherever it names the project`,
    );
  });

  test(`${pkg.name}: the description uses no banned pause punctuation`, () => {
    assert.ok(!pkg.description.includes(EM_DASH), `${pkg.rel} contains an em-dash`);
    // The two pause forms invariant 11 bans, both between words, so a compound
    // word ("AI-first"), a flag, and a range stay untouched.
    assert.ok(
      !/[A-Za-z)`] - [A-Za-z(`]/.test(pkg.description),
      `${pkg.rel} uses a space-hyphen as pause punctuation`,
    );
    assert.ok(
      !/[A-Za-z)`] ; [A-Za-z(`]/.test(pkg.description),
      `${pkg.rel} uses a space-semicolon as pause punctuation`,
    );
  });
}
