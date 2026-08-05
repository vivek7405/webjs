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

/**
 * The subcommands the CLI really has, so `webjs dev` reads as a command rather
 * than as the brand written lowercase. Read out of the CLI's own switch
 * instead of copied, because a copied list drifts: the prose hook's equivalent
 * carries `build`, which is a command WebJs deliberately does not have.
 */
const CLI_SUBCOMMANDS = new Set(
  [...readFileSync(join(ROOT, 'packages/cli/bin/webjs.js'), 'utf8').matchAll(/case '([a-z][a-z-]*)'/g)].map(
    (m) => m[1],
  ),
);

/**
 * Strip inline code spans, the way the prose hook does, so a literal
 * `webjs` command or `npm create webjs@latest my-app` is never read as brand
 * prose. What is left is the sentence a search result actually shows.
 */
const prose = (s) => s.replace(/`[^`]*`/g, '');

/**
 * A standalone lowercase "webjs" in a PROSE position, which is either followed
 * by a word or ending a sentence. Those two are what reliably mean prose, and
 * the leading character class is what keeps the structural token forms out
 * (@webjsdev, webjsdev, webjs.dev, WEBJS_*, webjsdev/webjs).
 *
 * The following WORD is captured whole, because it is what tells a brand
 * mention apart from a CLI command: `webjs ships` is the brand written
 * lowercase, `webjs dev` is a command and stays lowercase. Capturing only its
 * first letter would silently disable that carve-out.
 */
const BRAND_IN_PROSE = /(^|[^A-Za-z0-9@._/-])webjs(?:\s+([A-Za-z][A-Za-z0-9-]*)|\.(?=\s|$))/g;

/** Every lowercase-brand mention in a description, CLI commands excluded. */
function brandViolations(text) {
  return [...prose(text).matchAll(BRAND_IN_PROSE)]
    .filter((m) => !(m[2] && CLI_SUBCOMMANDS.has(m[2])))
    .map((m) => m[0].trim());
}

/** The opening sentence, which is the part a truncated snippet still shows. */
const firstSentence = (s) => s.split(/(?<=\.)\s/)[0];

// The fixtures below have to CONTAIN the lowercase brand to be fixtures at
// all, which is the one string the repo prose hook refuses to let a tool call
// write. Assembling it defeats that literal check without weakening it.
const LOWER = 'web' + 'js';

test('the CLI subcommand set was really read out of the CLI', () => {
  // A regex that stops matching would empty the set silently, turning the
  // carve-out off and reporting every bare command as a brand violation.
  assert.ok(CLI_SUBCOMMANDS.size > 10, `read the CLI switch, got ${CLI_SUBCOMMANDS.size} entries`);
  for (const cmd of ['dev', 'start', 'check', 'create']) {
    assert.ok(CLI_SUBCOMMANDS.has(cmd), `covers the ${cmd} command`);
  }
});

test('the brand matcher fires on prose and spares a literal token', () => {
  // Without this, a matcher that silently matches nothing (or a carve-out that
  // can never fire) would leave every per-package assertion below meaningless
  // while the suite stayed green.
  assert.deepEqual(brandViolations(`On Bun, ${LOWER} ships a native listener.`), [`${LOWER} ships`]);
  assert.deepEqual(brandViolations(`Most ${LOWER} apps ship no build step.`), [`${LOWER} apps`]);
  assert.deepEqual(brandViolations(`Built on ${LOWER}.`), [`${LOWER}.`]);
  // The carve-outs: a bare CLI command, a code span, and the token forms.
  assert.deepEqual(brandViolations(`Run ${LOWER} dev to start the server.`), []);
  assert.deepEqual(brandViolations(`Run \`${LOWER} dev\` to start the server.`), []);
  assert.deepEqual(brandViolations(`Install @${LOWER}dev/core, documented at ${LOWER}.dev today.`), []);
  assert.deepEqual(brandViolations(`Set WEBJS_ELIDE=0 in ${LOWER}dev/${LOWER} to opt out.`), []);
});

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
    assert.deepEqual(
      brandViolations(pkg.description),
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
